import Taro from '@tarojs/taro'
import { DATA_VERSION, STORAGE_KEYS } from '../constants'
import type {
  AppDataStore,
  CollectedPlace,
  PlaceInfo,
  TravelPlan,
  TripStop,
} from '../types'
import { combineDateTime, toDatePart, toTimePart } from '../utils/datetime'

function createEmptyStore(): AppDataStore {
  return {
    version: DATA_VERSION,
    currentUserId: null,
    plans: [],
    places: [],
    stops: [],
  }
}

function todayDatePart(): string {
  return toDatePart(new Date().toISOString())
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 旧版 points（含 expectedAt）迁移为 places + stops */
function migrateV1(raw: Record<string, unknown>): AppDataStore {
  const plansIn = Array.isArray(raw.plans) ? raw.plans : []
  const pointsIn = Array.isArray(raw.points) ? raw.points : []
  const places: CollectedPlace[] = []
  const stops: TripStop[] = []
  const plans: TravelPlan[] = []

  for (const item of plansIn) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const id = String(p.id || '')
    if (!id) continue
    const planPoints = pointsIn.filter(
      (pt) => pt && typeof pt === 'object' && (pt as { planId?: string }).planId === id,
    ) as Array<Record<string, unknown>>
    let startDate = typeof p.startDate === 'string' ? p.startDate : ''
    if (!startDate) {
      let earliest = ''
      for (const pt of planPoints) {
        const at = String(pt.expectedAt || pt.createdAt || '')
        if (!at) continue
        const day = toDatePart(at)
        if (!earliest || day < earliest) earliest = day
      }
      startDate = earliest || todayDatePart()
    }
    let lastDay = startDate
    for (const pt of planPoints) {
      const at = String(pt.expectedAt || '')
      if (!at) continue
      const day = toDatePart(at)
      if (day > lastDay) lastDay = day
    }
    let dayCount =
      typeof p.dayCount === 'number' && p.dayCount > 0 ? Math.floor(p.dayCount) : 1
    if (typeof p.dayCount !== 'number') {
      const [sy, sm, sd] = startDate.split('-').map(Number)
      const [ey, em, ed] = lastDay.split('-').map(Number)
      if (sy && sm && sd && ey && em && ed) {
        const start = new Date(sy, sm - 1, sd).getTime()
        const end = new Date(ey, em - 1, ed).getTime()
        dayCount = Math.max(1, Math.round((end - start) / 86400000) + 1)
      }
    }
    const placeIds: string[] = []
    const stopIds: string[] = []
    for (const pt of planPoints) {
      const placeId = String(pt.id || genId('place'))
      const ts = String(pt.createdAt || nowIso())
      places.push({
        id: placeId,
        planId: id,
        place: pt.place as PlaceInfo,
        createdAt: ts,
        updatedAt: String(pt.updatedAt || ts),
        noteHtml: typeof pt.noteHtml === 'string' ? pt.noteHtml : undefined,
        noteText: typeof pt.noteText === 'string' ? pt.noteText : undefined,
      })
      placeIds.push(placeId)
      const expectedAt = String(pt.expectedAt || '')
      if (expectedAt) {
        const stopId = genId('stop')
        stops.push({
          id: stopId,
          planId: id,
          placeId,
          expectedAt,
          createdAt: ts,
          updatedAt: String(pt.updatedAt || ts),
        })
        stopIds.push(stopId)
      }
    }
    plans.push({
      id,
      name: String(p.name || ''),
      description: String(p.description || ''),
      startDate,
      dayCount: Number.isFinite(dayCount) && dayCount > 0 ? dayCount : 1,
      placeIds,
      stopIds,
      createdAt: String(p.createdAt || nowIso()),
      updatedAt: String(p.updatedAt || nowIso()),
      userId: (p.userId as string | null | undefined) ?? null,
    })
  }

  return {
    version: DATA_VERSION,
    currentUserId: (raw.currentUserId as string | null) ?? null,
    plans,
    places,
    stops,
  }
}

function normalizePlan(raw: Record<string, unknown>): TravelPlan | null {
  const id = String(raw.id || '')
  if (!id) return null
  const startDate =
    typeof raw.startDate === 'string' && raw.startDate
      ? raw.startDate
      : todayDatePart()
  const dayCount =
    typeof raw.dayCount === 'number' && raw.dayCount > 0
      ? Math.floor(raw.dayCount)
      : 1
  return {
    id,
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    startDate,
    dayCount,
    placeIds: Array.isArray(raw.placeIds)
      ? raw.placeIds.map(String)
      : Array.isArray(raw.pointIds)
        ? raw.pointIds.map(String)
        : [],
    stopIds: Array.isArray(raw.stopIds) ? raw.stopIds.map(String) : [],
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    userId: (raw.userId as string | null | undefined) ?? null,
  }
}

function readStore(): AppDataStore {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.APP_DATA)
    if (!raw) return createEmptyStore()
    const data =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>)
    if (!data || typeof data !== 'object') return createEmptyStore()

    // v1：只有 points，没有 places
    if (Array.isArray(data.points) && !Array.isArray(data.places)) {
      const migrated = migrateV1(data)
      writeStore(migrated)
      return migrated
    }

    if (!Array.isArray(data.plans)) return createEmptyStore()
    const places = Array.isArray(data.places) ? (data.places as CollectedPlace[]) : []
    const stops = Array.isArray(data.stops) ? (data.stops as TripStop[]) : []
    const plans = (data.plans as Array<Record<string, unknown>>)
      .map(normalizePlan)
      .filter((p): p is TravelPlan => !!p)

    const store: AppDataStore = {
      version: DATA_VERSION,
      currentUserId: (data.currentUserId as string | null) ?? null,
      plans,
      places,
      stops,
    }
    const prevVersion = Number(data.version) || 0
    // v3：行程顺序改由 stopIds 决定；用 expectedAt 固化旧版时间排序视觉
    if (prevVersion < 3) {
      for (const plan of store.plans) {
        const ordered = store.stops
          .filter((s) => s.planId === plan.id)
          .sort(
            (a, b) =>
              new Date(a.expectedAt).getTime() - new Date(b.expectedAt).getTime(),
          )
          .map((s) => s.id)
        plan.stopIds = ordered
      }
    }
    if (prevVersion !== DATA_VERSION) writeStore(store)
    return store
  } catch {
    return createEmptyStore()
  }
}

function writeStore(store: AppDataStore): void {
  Taro.setStorageSync(STORAGE_KEYS.APP_DATA, { ...store, version: DATA_VERSION })
}

export function listPlans(): TravelPlan[] {
  const store = readStore()
  return [...store.plans].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function getPlan(planId: string): TravelPlan | undefined {
  return readStore().plans.find((p) => p.id === planId)
}

export function createPlan(input: {
  name: string
  description: string
  startDate: string
}): TravelPlan {
  const store = readStore()
  const ts = nowIso()
  const plan: TravelPlan = {
    id: genId('plan'),
    name: input.name.trim(),
    description: input.description.trim(),
    startDate: input.startDate || todayDatePart(),
    dayCount: 1,
    placeIds: [],
    stopIds: [],
    createdAt: ts,
    updatedAt: ts,
    userId: store.currentUserId,
  }
  store.plans.unshift(plan)
  writeStore(store)
  return plan
}

export function updatePlan(
  planId: string,
  input: { name: string; description: string; startDate: string },
): TravelPlan | undefined {
  const store = readStore()
  const idx = store.plans.findIndex((p) => p.id === planId)
  if (idx < 0) return undefined
  const prev = store.plans[idx]
  const startDate = input.startDate || prev.startDate || todayDatePart()
  const plan: TravelPlan = {
    ...prev,
    name: input.name.trim(),
    description: input.description.trim(),
    startDate,
    updatedAt: nowIso(),
  }
  store.plans[idx] = plan
  writeStore(store)
  return plan
}

export function setPlanDayCount(planId: string, dayCount: number): TravelPlan | undefined {
  const store = readStore()
  const idx = store.plans.findIndex((p) => p.id === planId)
  if (idx < 0) return undefined
  const next = Math.max(1, Math.floor(dayCount))
  const plan: TravelPlan = {
    ...store.plans[idx],
    dayCount: next,
    updatedAt: nowIso(),
  }
  store.plans[idx] = plan
  writeStore(store)
  return plan
}

export function deletePlan(planId: string): boolean {
  const store = readStore()
  const exists = store.plans.some((p) => p.id === planId)
  if (!exists) return false
  store.plans = store.plans.filter((p) => p.id !== planId)
  store.places = store.places.filter((p) => p.planId !== planId)
  store.stops = store.stops.filter((p) => p.planId !== planId)
  writeStore(store)
  return true
}

/** 收藏地点，按收藏时间倒序 */
export function listPlacesByPlan(planId: string): CollectedPlace[] {
  return readStore()
    .places.filter((p) => p.planId === planId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function getPlace(placeId: string): CollectedPlace | undefined {
  return readStore().places.find((p) => p.id === placeId)
}

/** @deprecated 用 getPlace */
export function getPoint(placeId: string): CollectedPlace | undefined {
  return getPlace(placeId)
}

export function createPlace(input: {
  planId: string
  place: PlaceInfo
}): CollectedPlace {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) throw new Error('计划不存在')
  const ts = nowIso()
  const collected: CollectedPlace = {
    id: genId('place'),
    planId: input.planId,
    place: input.place,
    createdAt: ts,
    updatedAt: ts,
  }
  store.places.push(collected)
  plan.placeIds.push(collected.id)
  plan.updatedAt = ts
  writeStore(store)
  return collected
}

/** @deprecated 用 createPlace；忽略 expectedAt */
export function createPoint(input: {
  planId: string
  place: PlaceInfo
  expectedAt?: string
}): CollectedPlace {
  return createPlace({ planId: input.planId, place: input.place })
}

export function updatePlaceNote(
  placeId: string,
  input: { noteHtml: string; noteText: string },
): CollectedPlace | undefined {
  const store = readStore()
  const idx = store.places.findIndex((p) => p.id === placeId)
  if (idx < 0) return undefined
  const ts = nowIso()
  const place: CollectedPlace = {
    ...store.places[idx],
    noteHtml: input.noteHtml,
    noteText: input.noteText.trim(),
    updatedAt: ts,
  }
  store.places[idx] = place
  const plan = store.plans.find((p) => p.id === place.planId)
  if (plan) plan.updatedAt = ts
  writeStore(store)
  return place
}

/** @deprecated */
export function updatePointNote(
  placeId: string,
  input: { noteHtml: string; noteText: string; expectedAt?: string },
): CollectedPlace | undefined {
  return updatePlaceNote(placeId, input)
}

export function deletePlace(placeId: string): boolean {
  const store = readStore()
  const place = store.places.find((p) => p.id === placeId)
  if (!place) return false
  store.places = store.places.filter((p) => p.id !== placeId)
  const removedStopIds = new Set(
    store.stops.filter((s) => s.placeId === placeId).map((s) => s.id),
  )
  store.stops = store.stops.filter((s) => s.placeId !== placeId)
  const plan = store.plans.find((p) => p.id === place.planId)
  if (plan) {
    plan.placeIds = plan.placeIds.filter((id) => id !== placeId)
    plan.stopIds = plan.stopIds.filter((id) => !removedStopIds.has(id))
    plan.updatedAt = nowIso()
  }
  writeStore(store)
  return true
}

/** @deprecated */
export function deletePoint(placeId: string): boolean {
  return deletePlace(placeId)
}

function sortStopsByIds(stops: TripStop[], stopIds: string[]): TripStop[] {
  const index = new Map(stopIds.map((id, i) => [id, i]))
  return [...stops].sort((a, b) => {
    const ai = index.has(a.id) ? (index.get(a.id) as number) : Number.MAX_SAFE_INTEGER
    const bi = index.has(b.id) ? (index.get(b.id) as number) : Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return String(a.createdAt).localeCompare(String(b.createdAt))
  })
}

export function listStopsByPlan(planId: string): TripStop[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === planId)
  const stops = store.stops.filter((s) => s.planId === planId)
  return sortStopsByIds(stops, plan?.stopIds || [])
}

export function getStop(stopId: string): TripStop | undefined {
  return readStore().stops.find((s) => s.id === stopId)
}

function ensureDayInPlan(plan: TravelPlan, datePart: string) {
  const start = new Date(`${plan.startDate}T12:00:00`)
  const day = new Date(`${datePart}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(day.getTime())) return
  const offset = Math.round((day.getTime() - start.getTime()) / 86400000)
  if (offset < 0) return
  if (offset + 1 > plan.dayCount) plan.dayCount = offset + 1
}

function nextTimeOnDay(store: AppDataStore, planId: string, datePart: string): string {
  const plan = store.plans.find((p) => p.id === planId)
  const sameDay = sortStopsByIds(
    store.stops.filter(
      (s) => s.planId === planId && toDatePart(s.expectedAt) === datePart,
    ),
    plan?.stopIds || [],
  )
  if (sameDay.length === 0) return combineDateTime(datePart, '09:00')
  const last = new Date(sameDay[sameDay.length - 1].expectedAt)
  last.setMinutes(last.getMinutes() + 60)
  return combineDateTime(
    datePart,
    `${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}`,
  )
}

/** 只改日期、保留时刻 */
function withDatePart(expectedAt: string, datePart: string): string {
  return combineDateTime(datePart, toTimePart(expectedAt) || '09:00')
}

/** 把若干收藏地点加到指定日期下（可重复引用） */
export function addStopsToDay(input: {
  planId: string
  datePart: string
  placeIds: string[]
}): TripStop[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) throw new Error('计划不存在')
  const created: TripStop[] = []
  const ts = nowIso()
  ensureDayInPlan(plan, input.datePart)
  for (const placeId of input.placeIds) {
    const place = store.places.find((p) => p.id === placeId && p.planId === input.planId)
    if (!place) continue
    const stop: TripStop = {
      id: genId('stop'),
      planId: input.planId,
      placeId,
      expectedAt: nextTimeOnDay(store, input.planId, input.datePart),
      createdAt: ts,
      updatedAt: ts,
    }
    store.stops.push(stop)
    plan.stopIds.push(stop.id)
    created.push(stop)
  }
  if (created.length > 0) {
    plan.updatedAt = ts
    writeStore(store)
  }
  return created
}

export function updateStopExpectedAt(
  stopId: string,
  expectedAt: string,
): TripStop | undefined {
  const store = readStore()
  const idx = store.stops.findIndex((s) => s.id === stopId)
  if (idx < 0) return undefined
  const ts = nowIso()
  const stop: TripStop = {
    ...store.stops[idx],
    expectedAt,
    updatedAt: ts,
  }
  store.stops[idx] = stop
  const plan = store.plans.find((p) => p.id === stop.planId)
  if (plan) {
    ensureDayInPlan(plan, toDatePart(expectedAt))
    plan.updatedAt = ts
  }
  writeStore(store)
  return stop
}

/**
 * 按分组顺序写回行程顺序（用于拖拽排序）
 * - 日内只改 stopIds 顺序，不改时间
 * - 跨日只改日期，保留原时刻
 */
export function reorderPlanStops(
  planId: string,
  groups: Array<{ datePart: string; stopIds: string[] }>,
): TripStop[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) throw new Error('计划不存在')
  const ts = nowIso()
  const seen = new Set<string>()
  const orderedIds: string[] = []

  groups.forEach((g) => {
    ensureDayInPlan(plan, g.datePart)
    g.stopIds.forEach((stopId) => {
      if (seen.has(stopId)) return
      seen.add(stopId)
      orderedIds.push(stopId)
      const idx = store.stops.findIndex(
        (s) => s.id === stopId && s.planId === planId,
      )
      if (idx < 0) return
      const prev = store.stops[idx]
      if (toDatePart(prev.expectedAt) === g.datePart) return
      store.stops[idx] = {
        ...prev,
        expectedAt: withDatePart(prev.expectedAt, g.datePart),
        updatedAt: ts,
      }
    })
  })

  const orphans = plan.stopIds.filter((id) => !seen.has(id))
  plan.stopIds = [...orderedIds, ...orphans]
  plan.updatedAt = ts
  writeStore(store)
  return listStopsByPlan(planId)
}

/** @deprecated 行程时间改用 updateStopExpectedAt */
export function updatePointExpectedAt(
  stopId: string,
  expectedAt: string,
): TripStop | undefined {
  return updateStopExpectedAt(stopId, expectedAt)
}

export function deleteStop(stopId: string): boolean {
  const store = readStore()
  const stop = store.stops.find((s) => s.id === stopId)
  if (!stop) return false
  store.stops = store.stops.filter((s) => s.id !== stopId)
  const plan = store.plans.find((p) => p.id === stop.planId)
  if (plan) {
    plan.stopIds = plan.stopIds.filter((id) => id !== stopId)
    plan.updatedAt = nowIso()
  }
  writeStore(store)
  return true
}

/** 解析行程点对应的收藏地点 */
export function resolveStopPlace(stop: TripStop): CollectedPlace | undefined {
  return getPlace(stop.placeId)
}

export type PlanViewMode = 'map' | 'timeline'

export function getLastPlanView(): PlanViewMode {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.LAST_PLAN_VIEW)
    if (raw === 'map' || raw === 'timeline') return raw
  } catch {
    // ignore
  }
  return 'timeline'
}

export function setLastPlanView(view: PlanViewMode) {
  try {
    Taro.setStorageSync(STORAGE_KEYS.LAST_PLAN_VIEW, view)
  } catch {
    // ignore
  }
}

/** 旧接口：按收藏时间倒序返回地点 */
export function listPointsByPlan(planId: string): CollectedPlace[] {
  return listPlacesByPlan(planId)
}

/** 导出完整应用数据 JSON 文本 */
export function getAppDataExportJson(): string {
  return JSON.stringify(readStore(), null, 2)
}

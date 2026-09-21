import Taro from '@tarojs/taro'
import { DATA_VERSION, STORAGE_KEYS } from '../constants'
import type {
  AppDataStore,
  CollectedPlace,
  PlaceInfo,
  TravelPlan,
  TripStop,
} from '../types'
import { datePartOfDay, dayIndexOfDate, normalizeNoteText, normalizeTimePart, toDatePart, toTimePart } from '../utils/datetime'

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
      })
      placeIds.push(placeId)
      const expectedAt = String(pt.expectedAt || '')
      if (expectedAt) {
        const stopId = genId('stop')
        const dayIndex = dayIndexOfDate(startDate, toDatePart(expectedAt))
        const time = normalizeTimePart(toTimePart(expectedAt))
        const note = normalizeNoteText(pt.note, pt.noteText, pt.noteHtml)
        stops.push({
          id: stopId,
          planId: id,
          placeId,
          dayIndex,
          ...(time ? { time } : {}),
          ...(note ? { note } : {}),
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

function writeStore(store: AppDataStore): void {
  Taro.setStorageSync(STORAGE_KEYS.APP_DATA, { ...store, version: DATA_VERSION })
}

/** 将导出的 JSON / 原始对象解析为可写入的 store（含旧版迁移） */
function parseAppDataPayload(data: Record<string, unknown>): AppDataStore {
  if (Array.isArray(data.points) && !Array.isArray(data.places)) {
    return migrateV1(data)
  }

  if (!Array.isArray(data.plans)) {
    throw new Error('缺少 plans 字段')
  }

  const placesIn = Array.isArray(data.places) ? data.places : []
  const stopsIn = Array.isArray(data.stops) ? data.stops : []
  const plans = (data.plans as Array<Record<string, unknown>>)
    .map(normalizePlan)
    .filter((p): p is TravelPlan => !!p)
  const planById = new Map(plans.map((p) => [p.id, p]))

  const places: CollectedPlace[] = []
  /** 旧版备注挂在 place 上，迁移到对应 stop */
  const legacyPlaceNotes = new Map<string, string>()
  for (const item of placesIn) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const id = String(p.id || '')
    const planId = String(p.planId || '')
    const place = p.place
    if (!id || !planId || !place || typeof place !== 'object') continue
    const info = place as PlaceInfo
    if (
      typeof info.latitude !== 'number' ||
      typeof info.longitude !== 'number' ||
      !info.name
    ) {
      continue
    }
    const legacyNote = normalizeNoteText(p.note, p.noteText, p.noteHtml)
    if (legacyNote) legacyPlaceNotes.set(id, legacyNote)
    places.push({
      id,
      planId,
      place: info,
      createdAt: String(p.createdAt || nowIso()),
      updatedAt: String(p.updatedAt || nowIso()),
      extra:
        p.extra && typeof p.extra === 'object'
          ? (p.extra as Record<string, unknown>)
          : undefined,
    })
  }

  const stops: TripStop[] = []
  for (const item of stopsIn) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const id = String(s.id || '')
    const planId = String(s.planId || '')
    const placeId = String(s.placeId || '')
    if (!id || !planId || !placeId) continue
    const plan = planById.get(planId)
    const expectedAt = typeof s.expectedAt === 'string' ? s.expectedAt : ''
    let dayIndex =
      typeof s.dayIndex === 'number' && Number.isFinite(s.dayIndex)
        ? Math.max(0, Math.floor(s.dayIndex))
        : null
    if (dayIndex == null && expectedAt) {
      dayIndex = dayIndexOfDate(
        plan?.startDate || todayDatePart(),
        toDatePart(expectedAt),
      )
    }
    if (dayIndex == null) continue
    let time = normalizeTimePart(s.time)
    if (!time && expectedAt) time = normalizeTimePart(toTimePart(expectedAt))
    let note = normalizeNoteText(s.note, s.noteText, s.noteHtml)
    if (!note) note = legacyPlaceNotes.get(placeId)
    stops.push({
      id,
      planId,
      placeId,
      dayIndex,
      ...(time ? { time } : {}),
      ...(note ? { note } : {}),
      extra:
        s.extra && typeof s.extra === 'object'
          ? (s.extra as Record<string, unknown>)
          : undefined,
    })
  }

  const store: AppDataStore = {
    version: DATA_VERSION,
    currentUserId: (data.currentUserId as string | null) ?? null,
    plans,
    places,
    stops,
  }

  for (const plan of store.plans) {
    const maxIdx = store.stops
      .filter((s) => s.planId === plan.id)
      .reduce((m, s) => Math.max(m, s.dayIndex), -1)
    if (maxIdx + 1 > plan.dayCount) plan.dayCount = maxIdx + 1
  }

  const prevVersion = Number(data.version) || 0
  if (prevVersion < 3) {
    for (const plan of store.plans) {
      const ordered = store.stops
        .filter((s) => s.planId === plan.id)
        .sort((a, b) => {
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex
          const at = a.time || ''
          const bt = b.time || ''
          if (at && bt && at !== bt) return at.localeCompare(bt)
          return a.id.localeCompare(b.id)
        })
        .map((s) => s.id)
      plan.stopIds = ordered
    }
  }

  return store
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

    const store = parseAppDataPayload(data)
    const prevVersion = Number(data.version) || 0
    if (
      (Array.isArray(data.points) && !Array.isArray(data.places)) ||
      prevVersion !== DATA_VERSION
    ) {
      writeStore(store)
    }
    return store
  } catch {
    return createEmptyStore()
  }
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

/** 地点去重指纹：优先 poiId，否则 name + 坐标（约 1m） */
function placeDedupeKey(place: PlaceInfo): string {
  const poiId = place.poiId?.trim()
  if (poiId) return `poi:${poiId}`
  const lat = Number(place.latitude.toFixed(5))
  const lng = Number(place.longitude.toFixed(5))
  return `geo:${place.name.trim()}|${lat}|${lng}`
}

function addDaysToDatePart(datePart: string, days: number): string {
  const d = new Date(`${datePart}T12:00:00`)
  if (Number.isNaN(d.getTime())) return datePart
  d.setDate(d.getDate() + days)
  return toDatePart(d.toISOString())
}

function datePartDiffDays(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`)
  const b = new Date(`${to}T12:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export type MergePlansResult =
  | {
      ok: true
      plan: TravelPlan
      mergedPlaceCount: number
      mergedStopCount: number
      sourcePlanCount: number
    }
  | { ok: false; message: string }

/**
 * 将多个计划合并为新计划（原计划保留不动）：
 * - 收藏地点去重后复制到新计划
 * - 日程按各计划原顺序依次复制，地点引用指向新计划内去重后的收藏
 */
export function mergePlans(planIds: string[]): MergePlansResult {
  const orderedIds = [...new Set(planIds.filter(Boolean))]
  if (orderedIds.length < 2) {
    return { ok: false, message: '请至少选择两个计划' }
  }

  const store = readStore()
  const plans = orderedIds
    .map((id) => store.plans.find((p) => p.id === id))
    .filter((p): p is TravelPlan => !!p)
  if (plans.length < 2) {
    return { ok: false, message: '所选计划不存在' }
  }

  const ts = nowIso()
  const primary = plans[0]
  const nameParts = plans.map((p) => p.name.trim()).filter(Boolean)
  const mergedName =
    nameParts.length <= 2
      ? nameParts.join(' + ')
      : `${nameParts[0]} 等${plans.length}个计划`
  const descParts = plans
    .map((p) => p.description.trim())
    .filter(Boolean)
  const description =
    descParts.length > 0
      ? descParts.join('\n')
      : `由「${nameParts.join('」「')}」合并生成`

  const dateCandidates: string[] = []
  for (const plan of plans) {
    if (plan.startDate) {
      dateCandidates.push(plan.startDate)
      dateCandidates.push(
        addDaysToDatePart(plan.startDate, Math.max(1, plan.dayCount) - 1),
      )
    }
  }

  // 旧 placeId → 新计划内 placeId
  const placeIdMap = new Map<string, string>()
  const dedupeMap = new Map<string, string>()
  const newPlaces: CollectedPlace[] = []
  const newStops: TripStop[] = []
  const mergedPlaceIds: string[] = []
  const mergedStopIds: string[] = []

  const clonePlace = (place: CollectedPlace) => {
    const key = placeDedupeKey(place.place)
    const existingId = dedupeMap.get(key)
    if (existingId) {
      placeIdMap.set(place.id, existingId)
      return
    }
    const id = genId('place')
    dedupeMap.set(key, id)
    placeIdMap.set(place.id, id)
    const cloned: CollectedPlace = {
      id,
      planId: '', // 稍后填入新计划 id
      place: { ...place.place },
      createdAt: place.createdAt || ts,
      updatedAt: ts,
      extra: place.extra ? { ...place.extra } : undefined,
    }
    newPlaces.push(cloned)
    mergedPlaceIds.push(id)
  }

  const stopDateParts = new Map<string, string>()
  for (const plan of plans) {
    const placesById = new Map(
      store.places.filter((p) => p.planId === plan.id).map((p) => [p.id, p]),
    )
    const orderedPlaces = [
      ...plan.placeIds
        .map((id) => placesById.get(id))
        .filter((p): p is CollectedPlace => !!p),
      ...[...placesById.values()].filter((p) => !plan.placeIds.includes(p.id)),
    ]
    for (const place of orderedPlaces) clonePlace(place)

    const stopsById = new Map(
      store.stops.filter((s) => s.planId === plan.id).map((s) => [s.id, s]),
    )
    const orderedStops = [
      ...plan.stopIds
        .map((id) => stopsById.get(id))
        .filter((s): s is TripStop => !!s),
      ...[...stopsById.values()].filter((s) => !plan.stopIds.includes(s.id)),
    ]
    for (const stop of orderedStops) {
      const mappedPlaceId = placeIdMap.get(stop.placeId)
      if (!mappedPlaceId) continue
      const id = genId('stop')
      const part = datePartOfDay(plan.startDate, stop.dayIndex)
      if (part) {
        dateCandidates.push(part)
        stopDateParts.set(id, part)
      }
      const cloned: TripStop = {
        id,
        planId: '',
        placeId: mappedPlaceId,
        dayIndex: stop.dayIndex,
        ...(stop.time ? { time: stop.time } : {}),
        ...(stop.note ? { note: stop.note } : {}),
        extra: stop.extra ? { ...stop.extra } : undefined,
      }
      newStops.push(cloned)
      mergedStopIds.push(id)
    }
  }

  const validDates = dateCandidates.filter(Boolean).sort()
  const startDate = validDates[0] || primary.startDate || todayDatePart()
  const endDate = validDates[validDates.length - 1] || startDate
  const dayCount = Math.max(1, datePartDiffDays(startDate, endDate) + 1)

  const newPlan: TravelPlan = {
    id: genId('plan'),
    name: mergedName.slice(0, 40),
    description,
    startDate,
    dayCount,
    placeIds: mergedPlaceIds,
    stopIds: mergedStopIds,
    createdAt: ts,
    updatedAt: ts,
    userId: store.currentUserId,
  }

  for (const place of newPlaces) place.planId = newPlan.id
  for (const stop of newStops) {
    stop.planId = newPlan.id
    const part = stopDateParts.get(stop.id)
    if (part) stop.dayIndex = dayIndexOfDate(startDate, part)
  }

  store.plans.unshift(newPlan)
  store.places.push(...newPlaces)
  store.stops.push(...newStops)
  writeStore(store)

  return {
    ok: true,
    plan: newPlan,
    mergedPlaceCount: mergedPlaceIds.length,
    mergedStopCount: mergedStopIds.length,
    sourcePlanCount: plans.length,
  }
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

export function updateStopNote(
  stopId: string,
  input: { note: string },
): TripStop | undefined {
  return updateStopSchedule(stopId, { note: input.note.trim() || null })
}

/** 更新收藏地点的展示信息（标题 / 类型等） */
export function updatePlaceInfo(
  placeId: string,
  input: {
    name?: string
    type?: string
    typecode?: string
  },
): CollectedPlace | undefined {
  const store = readStore()
  const idx = store.places.findIndex((p) => p.id === placeId)
  if (idx < 0) return undefined
  const ts = nowIso()
  const prev = store.places[idx]
  const nextPlace = { ...prev.place }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) return undefined
    nextPlace.name = name
  }
  if (input.type !== undefined) {
    nextPlace.type = input.type.trim() || undefined
  }
  if (input.typecode !== undefined) {
    nextPlace.typecode = input.typecode.trim() || undefined
  }
  const place: CollectedPlace = {
    ...prev,
    place: nextPlace,
    updatedAt: ts,
  }
  store.places[idx] = place
  const plan = store.plans.find((p) => p.id === place.planId)
  if (plan) plan.updatedAt = ts
  writeStore(store)
  return place
}

/** @deprecated 用 updateStopNote */
export function updatePlaceNote(
  stopId: string,
  input: { note: string },
): TripStop | undefined {
  return updateStopNote(stopId, input)
}

/** @deprecated */
export function updatePointNote(
  stopId: string,
  input: { note: string },
): TripStop | undefined {
  return updateStopNote(stopId, input)
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
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex
    return a.id.localeCompare(b.id)
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

function ensureDayIndexInPlan(plan: TravelPlan, dayIndex: number) {
  if (!Number.isFinite(dayIndex) || dayIndex < 0) return
  const next = Math.floor(dayIndex) + 1
  if (next > plan.dayCount) plan.dayCount = next
}

/** 把若干收藏地点加到指定天（可重复引用）；默认不写 time */
export function addStopsToDay(input: {
  planId: string
  dayIndex: number
  placeIds: string[]
}): TripStop[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) throw new Error('计划不存在')
  const created: TripStop[] = []
  const ts = nowIso()
  const dayIndex = Math.max(0, Math.floor(input.dayIndex))
  ensureDayIndexInPlan(plan, dayIndex)
  for (const placeId of input.placeIds) {
    const place = store.places.find((p) => p.id === placeId && p.planId === input.planId)
    if (!place) continue
    const stop: TripStop = {
      id: genId('stop'),
      planId: input.planId,
      placeId,
      dayIndex,
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

export function updateStopSchedule(
  stopId: string,
  input: { dayIndex?: number; time?: string | null; note?: string | null },
): TripStop | undefined {
  const store = readStore()
  const idx = store.stops.findIndex((s) => s.id === stopId)
  if (idx < 0) return undefined
  const prev = store.stops[idx]
  const stop: TripStop = { ...prev }
  if (input.dayIndex !== undefined) {
    stop.dayIndex = Math.max(0, Math.floor(input.dayIndex))
  }
  if (input.time !== undefined) {
    if (input.time == null || input.time === '') {
      delete stop.time
    } else {
      const time = normalizeTimePart(input.time)
      if (time) stop.time = time
      else delete stop.time
    }
  }
  if (input.note !== undefined) {
    if (input.note == null || input.note === '') {
      delete stop.note
    } else {
      stop.note = input.note.trim()
      if (!stop.note) delete stop.note
    }
  }
  store.stops[idx] = stop
  const plan = store.plans.find((p) => p.id === stop.planId)
  if (plan) {
    ensureDayIndexInPlan(plan, stop.dayIndex)
    plan.updatedAt = nowIso()
  }
  writeStore(store)
  return stop
}

/**
 * 按分组顺序写回行程顺序（用于拖拽排序）
 * - 日内只改 stopIds 顺序，不改 time
 * - 跨日只改 dayIndex，保留 time
 */
export function reorderPlanStops(
  planId: string,
  groups: Array<{ dayIndex: number; stopIds: string[] }>,
): TripStop[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) throw new Error('计划不存在')
  const ts = nowIso()
  const seen = new Set<string>()
  const orderedIds: string[] = []

  groups.forEach((g) => {
    const dayIndex = Math.max(0, Math.floor(g.dayIndex))
    ensureDayIndexInPlan(plan, dayIndex)
    g.stopIds.forEach((stopId) => {
      if (seen.has(stopId)) return
      seen.add(stopId)
      orderedIds.push(stopId)
      const idx = store.stops.findIndex(
        (s) => s.id === stopId && s.planId === planId,
      )
      if (idx < 0) return
      const prev = store.stops[idx]
      if (prev.dayIndex === dayIndex) return
      store.stops[idx] = {
        ...prev,
        dayIndex,
      }
    })
  })

  const orphans = plan.stopIds.filter((id) => !seen.has(id))
  plan.stopIds = [...orderedIds, ...orphans]
  plan.updatedAt = ts
  writeStore(store)
  return listStopsByPlan(planId)
}

/** @deprecated 用 updateStopSchedule */
export function updateStopExpectedAt(
  stopId: string,
  expectedAt: string,
): TripStop | undefined {
  const store = readStore()
  const stop = store.stops.find((s) => s.id === stopId)
  const planStart =
    store.plans.find((p) => p.id === stop?.planId)?.startDate || todayDatePart()
  return updateStopSchedule(stopId, {
    dayIndex: dayIndexOfDate(planStart, toDatePart(expectedAt)),
    time: toTimePart(expectedAt),
  })
}

/** @deprecated */
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

export type ImportAppDataResult =
  | {
      ok: true
      planCount: number
      placeCount: number
      stopCount: number
    }
  | { ok: false; message: string }

/**
 * 微信 Text 长按复制常会把空格变成 NBSP(\\u00A0)，导致 JSON.parse 失败。
 * 导入前先归一化常见 Unicode 空白。
 */
function sanitizeImportJsonText(raw: string): string {
  return raw
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/^\uFEFF/, '')
}

/** 用导出的 JSON 覆盖本地全部数据 */
export function importAppDataJson(raw: string): ImportAppDataResult {
  const text = sanitizeImportJsonText(raw).trim()
  if (!text) return { ok: false, message: '内容为空' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 格式无效' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: '数据格式无效' }
  }
  try {
    const store = parseAppDataPayload(parsed as Record<string, unknown>)
    writeStore(store)
    return {
      ok: true,
      planCount: store.plans.length,
      placeCount: store.places.length,
      stopCount: store.stops.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '导入失败'
    return { ok: false, message }
  }
}

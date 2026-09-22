import Taro from '@tarojs/taro'
import { DATA_VERSION, STORAGE_KEYS } from '../constants'
import type {
  AppDataStore,
  CollectedPlace,
  PlaceInfo,
  TravelPlan,
  TripStop,
} from '../types'
import {
  datePartOfDay,
  dayIndexOfDate,
  normalizeTimePart,
  toDatePart,
} from '../utils/datetime'

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

function normalizePlan(raw: Record<string, unknown>): TravelPlan | null {
  const id = String(raw.id || '')
  if (!id) return null
  if (!Array.isArray(raw.placeIds)) return null
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
    placeIds: raw.placeIds.map(String),
    stopIds: Array.isArray(raw.stopIds) ? raw.stopIds.map(String) : [],
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    userId: (raw.userId as string | null | undefined) ?? null,
  }
}

function writeStore(store: AppDataStore): void {
  Taro.setStorageSync(STORAGE_KEYS.APP_DATA, { ...store, version: DATA_VERSION })
}

/**
 * 解析应用数据。仅接受现行 schema（plans + places + stops，dayIndex）。
 * 中间版 / v1 points 结构一律拒绝。
 */
function parseAppDataPayload(data: Record<string, unknown>): AppDataStore {
  if (Array.isArray(data.points) && !Array.isArray(data.places)) {
    throw new Error('数据版本过旧，请使用当前版本导出的文件')
  }
  if (!Array.isArray(data.plans) || !Array.isArray(data.places)) {
    throw new Error('数据格式无效：需要 plans 与 places')
  }

  const stopsIn = Array.isArray(data.stops) ? data.stops : []
  const plans = (data.plans as Array<Record<string, unknown>>)
    .map(normalizePlan)
    .filter((p): p is TravelPlan => !!p)

  const places: CollectedPlace[] = []
  for (const item of data.places) {
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
    if (typeof s.dayIndex !== 'number' || !Number.isFinite(s.dayIndex)) continue
    const dayIndex = Math.max(0, Math.floor(s.dayIndex))
    const time = normalizeTimePart(s.time)
    const note =
      typeof s.note === 'string' && s.note.trim() ? s.note.trim() : undefined
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
    if (prevVersion !== DATA_VERSION) {
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

/**
 * 移除计划中某一空日：后续 stop.dayIndex 依次 -1，dayCount -1。
 * 至少保留 1 天；当日仍有行程时拒绝。
 */
export function removePlanDay(
  planId: string,
  dayIndex: number,
): TravelPlan | undefined {
  const store = readStore()
  const idx = store.plans.findIndex((p) => p.id === planId)
  if (idx < 0) return undefined
  const plan = store.plans[idx]
  const dayCount = Math.max(1, plan.dayCount || 1)
  const removeAt = Math.floor(dayIndex)
  if (!Number.isFinite(removeAt) || removeAt < 0 || removeAt >= dayCount) {
    return undefined
  }
  if (dayCount <= 1) return undefined

  const hasStops = store.stops.some(
    (s) => s.planId === planId && s.dayIndex === removeAt,
  )
  if (hasStops) return undefined

  for (const stop of store.stops) {
    if (stop.planId !== planId) continue
    if (stop.dayIndex > removeAt) {
      stop.dayIndex -= 1
    }
  }

  const next: TravelPlan = {
    ...plan,
    dayCount: dayCount - 1,
    updatedAt: nowIso(),
  }
  store.plans[idx] = next
  writeStore(store)
  return next
}

/**
 * 调整计划日顺序：将 fromIndex 移到 toIndex，重映射各 stop.dayIndex。
 * 日期展示仍按 startDate + 下标连续；只交换各日行程内容。
 * @returns map[oldDayIndex] = newDayIndex
 */
export function reorderPlanDays(
  planId: string,
  fromIndex: number,
  toIndex: number,
): { plan: TravelPlan; map: number[] } | undefined {
  const store = readStore()
  const idx = store.plans.findIndex((p) => p.id === planId)
  if (idx < 0) return undefined
  const plan = store.plans[idx]
  const dayCount = Math.max(1, plan.dayCount || 1)
  const from = Math.floor(fromIndex)
  const to = Math.floor(toIndex)
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to < 0 ||
    from >= dayCount ||
    to >= dayCount
  ) {
    return undefined
  }
  if (from === to) {
    return {
      plan,
      map: Array.from({ length: dayCount }, (_, i) => i),
    }
  }

  const order = Array.from({ length: dayCount }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  const map = new Array<number>(dayCount)
  order.forEach((oldIdx, newIdx) => {
    map[oldIdx] = newIdx
  })

  for (const stop of store.stops) {
    if (stop.planId !== planId) continue
    const di = stop.dayIndex
    if (di >= 0 && di < dayCount) {
      stop.dayIndex = map[di]
    }
  }

  const next: TravelPlan = {
    ...plan,
    updatedAt: nowIso(),
  }
  store.plans[idx] = next
  writeStore(store)
  return { plan: next, map }
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

function placeInfoSame(a: PlaceInfo, b: PlaceInfo): boolean {
  if (a.poiId && b.poiId) return a.poiId === b.poiId
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6 &&
    a.name === b.name
  )
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

/** 计划下全部地点（含仅被行程引用、已移出收藏的），供行程解析 */
export function listAllPlacesByPlan(planId: string): CollectedPlace[] {
  return readStore()
    .places.filter((p) => p.planId === planId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/** 收藏地点（plan.placeIds），按收藏列表顺序 */
export function listPlacesByPlan(planId: string): CollectedPlace[] {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === planId)
  if (!plan) return []
  const map = new Map(
    store.places.filter((p) => p.planId === planId).map((p) => [p.id, p]),
  )
  return plan.placeIds
    .map((id) => map.get(id))
    .filter((p): p is CollectedPlace => !!p)
}

export function getPlace(placeId: string): CollectedPlace | undefined {
  return readStore().places.find((p) => p.id === placeId)
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

/**
 * 加入收藏：已有同地点则写回 placeIds；否则新建。
 * 不删除任何行程。
 */
export function ensureFavoritePlace(input: {
  planId: string
  place: PlaceInfo
}): CollectedPlace {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) throw new Error('计划不存在')
  const existing = store.places.find(
    (p) => p.planId === input.planId && placeInfoSame(p.place, input.place),
  )
  if (existing) {
    if (!plan.placeIds.includes(existing.id)) {
      plan.placeIds.push(existing.id)
      plan.updatedAt = nowIso()
      writeStore(store)
    }
    return existing
  }
  return createPlace(input)
}

/**
 * 确保有地点记录可供行程引用；不写入收藏（placeIds）。
 * 已有同地点则复用。
 */
export function ensurePlaceRecord(input: {
  planId: string
  place: PlaceInfo
}): CollectedPlace {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) throw new Error('计划不存在')
  const existing = store.places.find(
    (p) => p.planId === input.planId && placeInfoSame(p.place, input.place),
  )
  if (existing) return existing
  const ts = nowIso()
  const collected: CollectedPlace = {
    id: genId('place'),
    planId: input.planId,
    place: input.place,
    createdAt: ts,
    updatedAt: ts,
  }
  store.places.push(collected)
  plan.updatedAt = ts
  writeStore(store)
  return collected
}

/**
 * 取消收藏：从 placeIds 移除。
 * 若仍有行程引用该地点则保留 place 记录（行程不删）；否则删除 place。
 */
export function unfavoritePlace(placeId: string): boolean {
  const store = readStore()
  const place = store.places.find((p) => p.id === placeId)
  if (!place) return false
  const plan = store.plans.find((p) => p.id === place.planId)
  if (plan) {
    plan.placeIds = plan.placeIds.filter((id) => id !== placeId)
    plan.updatedAt = nowIso()
  }
  const usedByStop = store.stops.some((s) => s.placeId === placeId)
  if (!usedByStop) {
    store.places = store.places.filter((p) => p.id !== placeId)
  }
  writeStore(store)
  return true
}

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

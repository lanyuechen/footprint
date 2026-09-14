import Taro from '@tarojs/taro'
import { DATA_VERSION, STORAGE_KEYS } from '../constants'
import type { AppDataStore, TargetPoint, TravelPlan } from '../types'

function createEmptyStore(): AppDataStore {
  return {
    version: DATA_VERSION,
    currentUserId: null,
    plans: [],
    points: [],
  }
}

function readStore(): AppDataStore {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.APP_DATA)
    if (!raw) return createEmptyStore()
    const data = typeof raw === 'string' ? (JSON.parse(raw) as AppDataStore) : (raw as AppDataStore)
    if (!data || !Array.isArray(data.plans) || !Array.isArray(data.points)) {
      return createEmptyStore()
    }
    return {
      ...createEmptyStore(),
      ...data,
      version: DATA_VERSION,
    }
  } catch {
    return createEmptyStore()
  }
}

function writeStore(store: AppDataStore): void {
  Taro.setStorageSync(STORAGE_KEYS.APP_DATA, store)
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 计划列表（按更新时间倒序） */
export function listPlans(): TravelPlan[] {
  const store = readStore()
  return [...store.plans].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function getPlan(planId: string): TravelPlan | undefined {
  return readStore().plans.find((p) => p.id === planId)
}

export function createPlan(input: { name: string; description: string }): TravelPlan {
  const store = readStore()
  const ts = nowIso()
  const plan: TravelPlan = {
    id: genId('plan'),
    name: input.name.trim(),
    description: input.description.trim(),
    pointIds: [],
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
  input: { name: string; description: string },
): TravelPlan | undefined {
  const store = readStore()
  const idx = store.plans.findIndex((p) => p.id === planId)
  if (idx < 0) return undefined
  const plan = {
    ...store.plans[idx],
    name: input.name.trim(),
    description: input.description.trim(),
    updatedAt: nowIso(),
  }
  store.plans[idx] = plan
  writeStore(store)
  return plan
}

/** 删除计划并级联删除其目标点 */
export function deletePlan(planId: string): boolean {
  const store = readStore()
  const exists = store.plans.some((p) => p.id === planId)
  if (!exists) return false
  store.plans = store.plans.filter((p) => p.id !== planId)
  store.points = store.points.filter((p) => p.planId !== planId)
  writeStore(store)
  return true
}

/** 某计划下的目标点，按预期时间正序 */
export function listPointsByPlan(planId: string): TargetPoint[] {
  return readStore()
    .points.filter((p) => p.planId === planId)
    .sort((a, b) => new Date(a.expectedAt).getTime() - new Date(b.expectedAt).getTime())
}

export function getPoint(pointId: string): TargetPoint | undefined {
  return readStore().points.find((p) => p.id === pointId)
}

export function createPoint(input: {
  planId: string
  place: TargetPoint['place']
  expectedAt: string
}): TargetPoint {
  const store = readStore()
  const plan = store.plans.find((p) => p.id === input.planId)
  if (!plan) {
    throw new Error('计划不存在')
  }
  const ts = nowIso()
  const point: TargetPoint = {
    id: genId('point'),
    planId: input.planId,
    place: input.place,
    expectedAt: input.expectedAt,
    createdAt: ts,
    updatedAt: ts,
  }
  store.points.push(point)
  plan.pointIds.push(point.id)
  plan.updatedAt = ts
  writeStore(store)
  return point
}

/** 更新目标点备注，也可同时改预期时间 */
export function updatePointNote(
  pointId: string,
  input: { noteHtml: string; noteText: string; expectedAt?: string },
): TargetPoint | undefined {
  const store = readStore()
  const idx = store.points.findIndex((p) => p.id === pointId)
  if (idx < 0) return undefined
  const ts = nowIso()
  const point: TargetPoint = {
    ...store.points[idx],
    noteHtml: input.noteHtml,
    noteText: input.noteText.trim(),
    expectedAt: input.expectedAt || store.points[idx].expectedAt,
    updatedAt: ts,
  }
  store.points[idx] = point
  const plan = store.plans.find((p) => p.id === point.planId)
  if (plan) plan.updatedAt = ts
  writeStore(store)
  return point
}

export function deletePoint(pointId: string): boolean {
  const store = readStore()
  const point = store.points.find((p) => p.id === pointId)
  if (!point) return false
  store.points = store.points.filter((p) => p.id !== pointId)
  const plan = store.plans.find((p) => p.id === point.planId)
  if (plan) {
    plan.pointIds = plan.pointIds.filter((id) => id !== pointId)
    plan.updatedAt = nowIso()
  }
  writeStore(store)
  return true
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

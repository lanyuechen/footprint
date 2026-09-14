/** 地点信息（来自高德搜索） */
export interface PlaceInfo {
  /** 高德 POI id，可能为空（手动选点场景预留） */
  poiId?: string
  name: string
  address: string
  latitude: number
  longitude: number
  /** 城市名等扩展信息，预留 */
  city?: string
}

/**
 * 目标点
 * 后续可扩展：备注、停留时长、完成状态、排序权重等
 */
export interface TargetPoint {
  id: string
  planId: string
  place: PlaceInfo
  /** 预期前往时间，ISO 字符串，精确到分钟 */
  expectedAt: string
  createdAt: string
  updatedAt: string
  /** 预留扩展字段 */
  extra?: Record<string, unknown>
}

/**
 * 旅行计划
 * 后续可扩展：userId、封面、状态、日期范围等
 */
export interface TravelPlan {
  id: string
  name: string
  description: string
  /** 目标点 id 列表（冗余，便于后续迁移；详情以 points 表为准） */
  pointIds: string[]
  createdAt: string
  updatedAt: string
  /** 预留：登录后写入用户 id */
  userId?: string | null
  /** 预留扩展字段 */
  extra?: Record<string, unknown>
}

export interface AppDataStore {
  version: number
  /** 预留登录态 */
  currentUserId: string | null
  plans: TravelPlan[]
  points: TargetPoint[]
}

export interface AmapPoi {
  id: string
  name: string
  address: string
  location: string
  cityname?: string
  pname?: string
  adname?: string
}

/** 高德 POI 商业信息，有值才保存 */
export interface PlaceBusiness {
  /** 所属商圈 */
  businessArea?: string
  /** 今日营业时间 */
  openTimeToday?: string
  /** 一周营业时间描述 */
  openTimeWeek?: string
  tel?: string
  /** 特色，目前主要是美食 */
  tag?: string
  /** 评分，餐饮/酒店/景点/影院 */
  rating?: string
  /** 人均消费 */
  cost?: string
  /** 停车场类型 */
  parkingType?: string
  alias?: string
}

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
  /** 与当前位置的直线距离（米），搜索时有定位则填充 */
  distanceMeters?: number
  /** 类型名称，大类;中类;小类 */
  type?: string
  /** 类型编码 */
  typecode?: string
  business?: PlaceBusiness
}

/**
 * 计划内收藏的地点（地图侧维护）
 * 行程通过 placeId 引用，可重复引用
 */
export interface CollectedPlace {
  id: string
  planId: string
  place: PlaceInfo
  createdAt: string
  updatedAt: string
  extra?: Record<string, unknown>
}

export type NavMode = 'walking' | 'riding' | 'transit'

/**
 * 行程点：对收藏地点的一次引用
 * 同一收藏地点可出现多次（往返等）
 */
export interface TripStop {
  id: string
  planId: string
  placeId: string
  /** 相对计划 startDate 的第几天，从 0 起；分组依据 */
  dayIndex: number
  /** 可选到访时刻 HH:mm；默认空，设置后才展示 */
  time?: string
  /** 该次行程的纯文本备注 */
  note?: string
  /** 关键节点：用于分段导航等 */
  isKeyNode?: boolean
  /** 前往该关键节点的方式；仅 isKeyNode 时有意义，默认 walking */
  travelMode?: NavMode
  extra?: Record<string, unknown>
}

/**
 * 旅行计划
 */
export interface TravelPlan {
  id: string
  name: string
  description: string
  /** 计划开始日，YYYY-MM-DD */
  startDate: string
  /** 从 startDate 起连续展示的天数，至少 1 */
  dayCount: number
  /** 收藏地点 id */
  placeIds: string[]
  /** 行程引用 id */
  stopIds: string[]
  createdAt: string
  updatedAt: string
  userId?: string | null
  extra?: Record<string, unknown>
}

export interface AppDataStore {
  version: number
  currentUserId: string | null
  plans: TravelPlan[]
  places: CollectedPlace[]
  stops: TripStop[]
}

export interface AmapPoi {
  id: string
  name: string
  address: string
  location: string
  cityname?: string
  pname?: string
  adname?: string
  distance?: string | number
  type?: string
  typecode?: string
  tel?: string
  business_area?: string
  business?: Record<string, unknown>
  biz_ext?: Record<string, unknown>
}

export type NavStepKind = 'walk' | 'ride' | 'bus' | 'metro' | 'railway' | 'other'

export interface NavRoutePoint {
  latitude: number
  longitude: number
}

export interface NavRouteStep {
  kind: NavStepKind
  title: string
  detail?: string
  distanceMeters?: number
  durationSeconds?: number
  points?: NavRoutePoint[]
  color?: string
}

export interface NavRoute {
  mode: NavMode
  distanceMeters: number
  durationSeconds: number
  points: NavRoutePoint[]
  summary?: string
  steps: NavRouteStep[]
}

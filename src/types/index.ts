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
 * 目标点
 * 后续可扩展：停留时长、完成状态、排序权重等
 */
export interface TargetPoint {
  id: string
  planId: string
  place: PlaceInfo
  /** 预期前往时间，ISO 字符串，精确到分钟 */
  expectedAt: string
  createdAt: string
  updatedAt: string
  /** 备注（原生 editor HTML，后续可换扩展编辑器） */
  noteHtml?: string
  /** 备注纯文本，便于列表预览 */
  noteText?: string
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
  /** 周边搜索等接口可能返回，单位米 */
  distance?: string | number
  type?: string
  typecode?: string
  /** v3 常在根上；v5 在 business 内 */
  tel?: string
  business_area?: string
  business?: Record<string, unknown>
  biz_ext?: Record<string, unknown>
}

/** 导航出行方式（可继续扩展） */
export type NavMode = 'walking' | 'riding' | 'transit'

export type NavStepKind = 'walk' | 'ride' | 'bus' | 'metro' | 'railway' | 'other'

export interface NavRoutePoint {
  latitude: number
  longitude: number
}

/** 路线分步（步行转弯 / 公交换乘段等） */
export interface NavRouteStep {
  kind: NavStepKind
  /** 主文案，如「向东步行100米」「乘坐地铁2号线」 */
  title: string
  /** 补充说明，如上下车站 */
  detail?: string
  distanceMeters?: number
  durationSeconds?: number
  /** 该分段对应的路径坐标，用于地图着色与聚焦 */
  points?: NavRoutePoint[]
  /** 地图折线颜色 */
  color?: string
}

export interface NavRoute {
  mode: NavMode
  distanceMeters: number
  durationSeconds: number
  points: NavRoutePoint[]
  /** 简要说明，如公交线路名串联 */
  summary?: string
  /** 分步指引 */
  steps: NavRouteStep[]
}

import { useDidShow, useLoad } from '@tarojs/taro'
import { View, Text, Input, Map, ScrollView, RichText } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react'
import type { ComponentType } from 'react'
import type { PlaceInfo, TargetPoint, TravelPlan } from '../../types'
import { getUserLocation, lookupMapPlace, searchPlaces } from '../../services/amap'
import type { UserLocation } from '../../services/amap'
import {
  createPoint,
  deletePoint,
  getPlan,
  getLastPlanView,
  listPointsByPlan,
  setLastPlanView,
} from '../../services/storage'
import { formatClock, formatDateTime, formatDistance } from '../../utils/datetime'
import {
  Bike,
  Banknote,
  Building,
  Building2,
  Bus,
  Car,
  CircleParking,
  Dumbbell,
  GraduationCap,
  Hospital,
  Hotel,
  Landmark,
  ListTree,
  MapPin,
  MapPinned,
  Mountain,
  Navigation,
  Plane,
  ShoppingBag,
  Ship,
  SquarePen,
  Star,
  Store,
  Ticket,
  TrainFront,
  TramFront,
  Trees,
  Utensils,
  Wrench,
} from 'lucide-react-taro'
import './index.scss'

/**
 * 搜索栏三档位置：
 * - bottom：底部，仅搜索框
 * - middle：中部半屏，选地图点 / 选中搜索结果
 * - top：顶部全屏，搜索框获焦
 */
type SheetPos = 'bottom' | 'middle' | 'top'
/** browsing=bottom, preview=middle, searching=top */
type MapUiMode = 'browsing' | 'searching' | 'preview'
/** search: 展示地点详情卡；collected: 仅已收藏列表并高亮 */
type PreviewKind = 'search' | 'collected'
type PlanView = 'map' | 'timeline'

type AxisIcon = ComponentType<{ size?: number; color?: string }>
type AxisMark = { icon: AxisIcon; color: string }

const AXIS_DEFAULT: AxisMark = { icon: MapPin, color: '#1a5f4a' }

/** 把类型色混入白色，作为图标底衬 */
function lightenColor(hex: string, mix = 0.82) {
  const n = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  const mixed = channels.map((c) => Math.round(c + (255 - c) * mix))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** 高德大类编码前两位 → 时间轴图标和颜色 */
const PLACE_MAJOR_MARKS: Record<string, AxisMark> = {
  '01': { icon: Car, color: '#0ea5e9' },
  '02': { icon: Car, color: '#0ea5e9' },
  '03': { icon: Wrench, color: '#d97706' },
  '04': { icon: Bike, color: '#06b6d4' },
  '05': { icon: Utensils, color: '#f97316' },
  '06': { icon: ShoppingBag, color: '#ec4899' },
  '07': { icon: Store, color: '#14b8a6' },
  '08': { icon: Dumbbell, color: '#22c55e' },
  '09': { icon: Hospital, color: '#ef4444' },
  '10': { icon: Hotel, color: '#8b5cf6' },
  '11': { icon: Mountain, color: '#10b981' },
  '12': { icon: Building2, color: '#64748b' },
  '13': { icon: Landmark, color: '#3b82f6' },
  '14': { icon: GraduationCap, color: '#6366f1' },
  '16': { icon: Banknote, color: '#eab308' },
  '17': { icon: Building, color: '#78716c' },
  '22': { icon: Ticket, color: '#f43f5e' },
}

/** 交通设施按中类再分 */
const PLACE_TRANSIT_MARKS: Record<string, AxisMark> = {
  '1501': { icon: Plane, color: '#2563eb' },
  '1502': { icon: TrainFront, color: '#1e3a8a' },
  '1503': { icon: Ship, color: '#0e7490' },
  '1504': { icon: Bus, color: '#c2410c' },
  '1505': { icon: TramFront, color: '#7c3aed' },
  '1506': { icon: TramFront, color: '#7c3aed' },
  '1507': { icon: Bus, color: '#c2410c' },
  '1509': { icon: CircleParking, color: '#57534e' },
}

const PLACE_PARK_MARK: AxisMark = { icon: Trees, color: '#84cc16' }

function placeAxisMark(place: PlaceInfo): AxisMark {
  const code = (place.typecode || '').split('|')[0].replace(/\D/g, '')
  const transit = PLACE_TRANSIT_MARKS[code.slice(0, 4)]
  if (transit) return transit
  if (code.slice(0, 4) === '1101') return PLACE_PARK_MARK
  const major = PLACE_MAJOR_MARKS[code.slice(0, 2)]
  if (major) return major

  const type = place.type || ''
  if (/机场/.test(type)) return PLACE_TRANSIT_MARKS['1501']
  if (/火车|高铁/.test(type)) return PLACE_TRANSIT_MARKS['1502']
  if (/地铁|轻轨/.test(type)) return PLACE_TRANSIT_MARKS['1505']
  if (/公交|汽车站/.test(type)) return PLACE_TRANSIT_MARKS['1507']
  if (/港口|码头|轮渡/.test(type)) return PLACE_TRANSIT_MARKS['1503']
  if (/停车/.test(type)) return PLACE_TRANSIT_MARKS['1509']
  if (/餐饮|美食|餐厅/.test(type)) return PLACE_MAJOR_MARKS['05']
  if (/酒店|宾馆|住宿/.test(type)) return PLACE_MAJOR_MARKS['10']
  if (/购物|商场|超市/.test(type)) return PLACE_MAJOR_MARKS['06']
  if (/医院|医疗|诊所/.test(type)) return PLACE_MAJOR_MARKS['09']
  if (/学校|大学|科教/.test(type)) return PLACE_MAJOR_MARKS['14']
  if (/公园/.test(type)) return PLACE_PARK_MARK
  if (/风景|景点|名胜/.test(type)) return PLACE_MAJOR_MARKS['11']
  if (/政府/.test(type)) return PLACE_MAJOR_MARKS['13']
  return AXIS_DEFAULT
}

function formatPlaceType(type?: string) {
  if (!type) return ''
  return type
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}

function byExpectedAt(a: TargetPoint, b: TargetPoint) {
  return new Date(a.expectedAt).getTime() - new Date(b.expectedAt).getTime()
}

function localDayStart(iso: string): Date | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addLocalDays(day: Date, days: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)
}

function localDayKey(day: Date) {
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`
}

function groupPointsByYear(points: TargetPoint[]) {
  const years: Array<{
    key: string
    label: string
    days: Array<{ key: string; label: string; weekday: string; points: TargetPoint[] }>
  }> = []
  const byDay: Record<string, TargetPoint[]> = {}
  let start: Date | null = null
  let end: Date | null = null
  for (const point of [...points].sort(byExpectedAt)) {
    const day = localDayStart(point.expectedAt)
    if (!day) continue
    const key = localDayKey(day)
    const list = byDay[key]
    if (list) list.push(point)
    else byDay[key] = [point]
    if (!start || day.getTime() < start.getTime()) start = day
    if (!end || day.getTime() > end.getTime()) end = day
  }
  if (!start || !end) return years

  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addLocalDays(cursor, 1)) {
    const yKey = String(cursor.getFullYear())
    let year = years[years.length - 1]
    if (!year || year.key !== yKey) {
      year = { key: yKey, label: `${cursor.getFullYear()}年`, days: [] }
      years.push(year)
    }
    const key = localDayKey(cursor)
    year.days.push({
      key,
      label: `${cursor.getMonth() + 1}月${cursor.getDate()}日`,
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][cursor.getDay()],
      points: byDay[key] ?? [],
    })
  }
  return years
}

function placeInfoRows(place: PlaceInfo) {
  const rows: Array<{ label: string; value: string }> = []
  const type = formatPlaceType(place.type)
  if (type) rows.push({ label: '类型', value: type })
  const business = place.business
  if (!business) return rows
  if (business.alias) rows.push({ label: '别名', value: business.alias })
  if (business.businessArea) {
    rows.push({ label: '商圈', value: business.businessArea })
  }
  if (business.rating) rows.push({ label: '评分', value: business.rating })
  if (business.cost) rows.push({ label: '人均', value: business.cost })
  if (business.tag) rows.push({ label: '特色', value: business.tag })
  if (business.openTimeToday) {
    rows.push({ label: '今日营业', value: business.openTimeToday })
  }
  if (business.openTimeWeek) {
    rows.push({ label: '营业时间', value: business.openTimeWeek })
  }
  if (business.tel) rows.push({ label: '电话', value: business.tel })
  if (business.parkingType) {
    rows.push({ label: '停车场', value: business.parkingType })
  }
  return rows
}

const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }
const SEARCH_DEBOUNCE_MS = 400
const MARKER_ID_SEARCH = 9000
const PLAN_MAP_ID = 'plan-view-map'
const SHEET_BOTTOM_RPX = 168
const SHEET_MIDDLE_VH = 0.52
/** 与底栏 height transition 对齐 */
const MAP_CENTER_EASE_MS = 320

function getWindowMetrics() {
  const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
  return {
    windowHeight: info.windowHeight,
    windowWidth: info.windowWidth,
  }
}

function sheetHeightPx(pos: SheetPos): number {
  const { windowHeight, windowWidth } = getWindowMetrics()
  if (pos === 'top') return windowHeight
  if (pos === 'middle') return windowHeight * SHEET_MIDDLE_VH
  return (SHEET_BOTTOM_RPX / 750) * windowWidth
}

function coverRatioFromSheetHeight(heightPx: number): number {
  const { windowHeight } = getWindowMetrics()
  if (windowHeight <= 0) return 0.12
  return Math.min(Math.max(heightPx / windowHeight, 0), 0.7)
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

function nearlySameCoord(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-7 &&
    Math.abs(a.longitude - b.longitude) < 1e-7
  )
}

function mapUiToSheetPos(
  mapUi: MapUiMode,
  leavingSearch: boolean,
): SheetPos {
  // 收起动画中统一视为底部
  if (leavingSearch) return 'bottom'
  if (mapUi === 'searching') return 'top'
  if (mapUi === 'preview') return 'middle'
  return 'bottom'
}

/**
 * 估算当前缩放下地图纬度跨度（仅作 getRegion 前的回退）。
 */
function estimateMapLatSpan(
  scale: number,
  latitude: number,
  mapHeightPx?: number,
) {
  const { windowHeight } = getWindowMetrics()
  const height = Math.max(mapHeightPx ?? windowHeight, 1)
  const zoom = Math.min(Math.max(scale, 3), 20)
  const metersPerPixel =
    (156543.03392804097 * Math.cos((latitude * Math.PI) / 180)) /
    Math.pow(2, zoom)
  return (metersPerPixel * height) / 111320
}

function readLatSpanFromRegion(region?: {
  northeast?: { latitude: number; longitude: number }
  southwest?: { latitude: number; longitude: number }
  southeast?: { latitude: number; longitude: number }
}): number | null {
  if (!region?.northeast) return null
  const sw = region.southwest || region.southeast
  if (!sw) return null
  const span = Math.abs(region.northeast.latitude - sw.latitude)
  return span > 1e-8 ? span : null
}

/**
 * 把目标点对齐到「未被底栏遮挡」的可视中心。
 * latSpan 必须尽量来自地图真实可视区域，避免不同缩放等级偏移不准。
 */
function offsetCenterForSheet(
  center: { latitude: number; longitude: number },
  coverRatio: number,
  latSpan: number,
) {
  if (!(latSpan > 0)) return { ...center }
  const clamped = Math.min(Math.max(coverRatio, 0), 0.7)
  return {
    latitude: center.latitude - latSpan * (clamped / 2),
    longitude: center.longitude,
  }
}

/** 由地图组件中心反推「可视锚点」 */
function reverseOffsetCenterForSheet(
  mapCenter: { latitude: number; longitude: number },
  coverRatio: number,
  latSpan: number,
) {
  if (!(latSpan > 0)) return { ...mapCenter }
  const clamped = Math.min(Math.max(coverRatio, 0), 0.7)
  return {
    latitude: mapCenter.latitude + latSpan * (clamped / 2),
    longitude: mapCenter.longitude,
  }
}

/**
 * 根据全部点的包围盒计算中心与缩放，使点落在底栏上方可视区域内。
 * 包围盒外扩三分之一，避免点贴边。
 */
function fitMapToPoints(
  coords: Array<{ latitude: number; longitude: number }>,
  coverRatio: number,
): { center: { latitude: number; longitude: number }; scale: number } {
  if (coords.length === 0) {
    return { center: { ...DEFAULT_CENTER }, scale: 12 }
  }
  if (coords.length === 1) {
    return {
      center: {
        latitude: coords[0].latitude,
        longitude: coords[0].longitude,
      },
      scale: 15,
    }
  }

  let minLat = coords[0].latitude
  let maxLat = coords[0].latitude
  let minLng = coords[0].longitude
  let maxLng = coords[0].longitude
  for (let i = 1; i < coords.length; i++) {
    const { latitude, longitude } = coords[i]
    if (latitude < minLat) minLat = latitude
    if (latitude > maxLat) maxLat = latitude
    if (longitude < minLng) minLng = longitude
    if (longitude > maxLng) maxLng = longitude
  }

  const center = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  }

  // 外扩三分之一：跨度 × 4/3，四周各留出约 1/6
  const latSpan = Math.max(maxLat - minLat, 1e-5) * (4 / 3)
  const lngSpan = Math.max(maxLng - minLng, 1e-5) * (4 / 3)

  const { windowHeight, windowWidth } = getWindowMetrics()
  const cosLat = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.2)
  const visibleHeightRatio = Math.max(
    1 - Math.min(Math.max(coverRatio, 0), 0.7),
    0.35,
  )
  // 高度需扣底栏；经度必须用屏幕宽度，否则横跨点会算得过近、贴左右边
  const neededFullLat = latSpan / visibleHeightRatio
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * cosLat
  const scaleFromLat = Math.log2(
    (156543.03392804097 * cosLat * windowHeight) /
      (metersPerDegLat * neededFullLat),
  )
  const scaleFromLng = Math.log2(
    (156543.03392804097 * cosLat * windowWidth) /
      (metersPerDegLng * lngSpan),
  )

  let scale = Math.min(scaleFromLat, scaleFromLng)
  if (!Number.isFinite(scale)) scale = 12
  // 向下取整略放大视野，避免贴边
  scale = Math.min(17, Math.max(4, Math.floor(scale)))

  return { center, scale }
}

function isSamePlace(a: PlaceInfo, b: PlaceInfo): boolean {
  if (a.poiId && b.poiId) return a.poiId === b.poiId
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6 &&
    a.name === b.name
  )
}

type PlanMapProps = {
  latitude: number
  longitude: number
  scale: number
  markers: Array<Record<string, unknown>>
  onRegionChange: (e: {
    type?: string
    causedBy?: string
    detail?: Record<string, unknown>
  }) => void
  onMarkertap: (e: { detail: { markerId: number | string } }) => void
  onPoiTap: (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => void
  onClick: () => void
}

/** 用户拖/缩放地图期间为 true：冻结 PlanMap 重渲染，避免受控 lat/lng 把拖动拽回去 */
const mapUserGesturingRef = { current: false }

/** 隔离无关 setState；手势中完全跳过重渲染 */
const PlanMap = memo(
  function PlanMap({
    latitude,
    longitude,
    scale,
    markers,
    onRegionChange,
    onMarkertap,
    onPoiTap,
    onClick,
  }: PlanMapProps) {
    return (
      <Map
        id={PLAN_MAP_ID}
        className='map-stage__map'
        latitude={latitude}
        longitude={longitude}
        scale={scale}
        markers={markers as never}
        showLocation
        onRegionChange={onRegionChange as never}
        onMarkertap={onMarkertap}
        onPoiTap={onPoiTap}
        onClick={onClick}
      />
    )
  },
  (prev, next) => {
    if (mapUserGesturingRef.current) return true
    return (
      prev.latitude === next.latitude &&
      prev.longitude === next.longitude &&
      prev.scale === next.scale &&
      prev.markers === next.markers &&
      prev.onRegionChange === next.onRegionChange &&
      prev.onMarkertap === next.onMarkertap &&
      prev.onPoiTap === next.onPoiTap &&
      prev.onClick === next.onClick
    )
  },
)

export default function PlanViewPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [points, setPoints] = useState<TargetPoint[]>([])
  const [mapUi, setMapUi] = useState<MapUiMode>('browsing')
  const [previewKind, setPreviewKind] = useState<PreviewKind>('search')

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [focusCoord, setFocusCoord] = useState(DEFAULT_CENTER)
  const [mapScale, setMapScale] = useState(12)

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PlaceInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  /** 当前聚焦地点（决定地图标点放大 / 列表高亮） */
  const [selectedPlace, setSelectedPlace] = useState<PlaceInfo | null>(null)
  /** 搜索选中后钉在「搜索框与已收藏」之间，点其他点时不移除 */
  const [pinnedSearchPlace, setPinnedSearchPlace] = useState<PlaceInfo | null>(null)

  const [inputFocus, setInputFocus] = useState(false)
  /** 取消搜索时先收起高度，动画结束后再切回浏览态 */
  const [leavingSearch, setLeavingSearch] = useState(false)
  const [scrollIntoView, setScrollIntoView] = useState('')
  /** 拖拽中的实时高度（px），null 表示跟档位 class */
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  /** 地图 / 时间轴，进入时恢复上次选择，没有则用时间轴 */
  const [planView, setPlanView] = useState<PlanView>(getLastPlanView)
  const [expandedId, setExpandedId] = useState('')
  /** 已从存储删除、但仍在列表中展示的点，等底栏收起后再同步列表 */
  const [deferredUncollectIds, setDeferredUncollectIds] = useState<Set<string>>(
    () => new Set(),
  )

  const searchSeq = useRef(0)
  const skipBrowseRecenter = useRef(false)
  const lastQueryRef = useRef('')
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{
    active: boolean
    startY: number
    startH: number
    from: SheetPos
  } | null>(null)
  const mapCenterDisplayRef = useRef(DEFAULT_CENTER)
  const mapCenterAnimRaf = useRef<number | null>(null)
  const sheetCoverRatioRef = useRef(0.12)
  const mapScaleRef = useRef(12)
  const mapViewLatSpanRef = useRef(0)
  const sheetDraggingRef = useRef(false)
  /** 下次 target 变化只同步 ref，不驱动地图（用于手势结束后的状态对齐） */
  const suppressCenterFollowRef = useRef(false)
  /** 忽略由我们改 lat/lng 触发的 regionchange */
  const ignoreMapRegionRef = useRef(false)
  const ignoreMapRegionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 地图真实可视纬度跨度（来自 getRegion / regionchange） */
  const [mapViewLatSpan, setMapViewLatSpan] = useState(0)

  const refresh = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      setPoints([])
      setDeferredUncollectIds(new Set())
      return
    }
    setPlan(p)
    setPoints(listPointsByPlan(id))
    setDeferredUncollectIds(new Set())
    Taro.setNavigationBarTitle({ title: p.name || '计划' })
  }

  const refreshPlanMeta = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      return
    }
    setPlan(p)
    Taro.setNavigationBarTitle({ title: p.name || '计划' })
  }

  useLoad((options) => {
    const id = options?.id || ''
    setPlanId(id)
    refresh(id)
  })

  useDidShow(() => {
    if (planId) refresh(planId)
  })

  useEffect(() => {
    return () => {
      if (focusTimer.current) clearTimeout(focusTimer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      if (ignoreMapRegionTimer.current) clearTimeout(ignoreMapRegionTimer.current)
      if (mapCenterAnimRaf.current != null) {
        cancelAnimationFrame(mapCenterAnimRaf.current)
        mapCenterAnimRaf.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getUserLocation().then((loc) => {
      if (cancelled || !loc) return
      setUserLocation(loc)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 仅在目标点集合变化时更新浏览视野；收起搜索过程中跳过，避免地图跳动
    if (mapUi !== 'browsing' || leavingSearch) return
    if (skipBrowseRecenter.current) {
      skipBrowseRecenter.current = false
      return
    }

    const browseCover = coverRatioFromSheetHeight(sheetHeightPx('bottom'))
    if (points.length > 0) {
      const fitted = fitMapToPoints(
        points.map((p) => ({
          latitude: p.place.latitude,
          longitude: p.place.longitude,
        })),
        browseCover,
      )
      setFocusCoord(fitted.center)
      setMapScale(fitted.scale)
    } else if (userLocation) {
      setFocusCoord(userLocation)
      setMapScale(13)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, userLocation])

  useEffect(() => {
    if (mapUi !== 'searching' || leavingSearch) return

    const q = keyword.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      setHasSearched(false)
      lastQueryRef.current = ''
      return
    }

    // 已有同一关键词的结果时，不重复请求（从地点卡片回到搜索）
    if (results.length > 0 && lastQueryRef.current === q) {
      setHasSearched(true)
      return
    }

    const seq = ++searchSeq.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const list = await searchPlaces(q, userLocation)
        if (seq !== searchSeq.current) return
        lastQueryRef.current = q
        setResults(list)
        setHasSearched(true)
      } catch (err) {
        if (seq !== searchSeq.current) return
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err && 'errMsg' in err
              ? String((err as { errMsg: string }).errMsg)
              : '搜索失败'
        console.error('[plan-map-search]', err)
        await Taro.showModal({
          title: '搜索失败',
          content: msg,
          showCancel: false,
        })
        lastQueryRef.current = q
        setResults([])
        setHasSearched(true)
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [keyword, userLocation, mapUi, leavingSearch, results.length])

  const collectedPoint = useMemo(() => {
    if (!pinnedSearchPlace) return undefined
    return points.find(
      (p) =>
        isSamePlace(p.place, pinnedSearchPlace) &&
        !deferredUncollectIds.has(p.id),
    )
  }, [points, pinnedSearchPlace, deferredUncollectIds])

  const sheetPos = mapUiToSheetPos(mapUi, leavingSearch)

  const sheetHeightNow =
    dragHeightPx != null ? dragHeightPx : sheetHeightPx(sheetPos)
  const sheetCoverRatio = coverRatioFromSheetHeight(sheetHeightNow)
  sheetCoverRatioRef.current = sheetCoverRatio
  mapScaleRef.current = mapScale
  sheetDraggingRef.current = dragHeightPx != null

  const effectiveLatSpan =
    mapViewLatSpan > 0
      ? mapViewLatSpan
      : estimateMapLatSpan(mapScale, focusCoord.latitude)

  const targetMapCenter = useMemo(
    () => offsetCenterForSheet(focusCoord, sheetCoverRatio, effectiveLatSpan),
    [focusCoord, sheetCoverRatio, effectiveLatSpan],
  )

  const [mapCenter, setMapCenter] = useState(targetMapCenter)

  const clearIgnoreMapRegion = () => {
    if (ignoreMapRegionTimer.current) {
      clearTimeout(ignoreMapRegionTimer.current)
      ignoreMapRegionTimer.current = null
    }
    ignoreMapRegionRef.current = false
  }

  const armIgnoreMapRegion = (ms: number) => {
    ignoreMapRegionRef.current = true
    if (ignoreMapRegionTimer.current) clearTimeout(ignoreMapRegionTimer.current)
    ignoreMapRegionTimer.current = setTimeout(() => {
      ignoreMapRegionRef.current = false
      ignoreMapRegionTimer.current = null
    }, ms)
  }

  const cancelMapCenterAnim = () => {
    if (mapCenterAnimRaf.current != null) {
      cancelAnimationFrame(mapCenterAnimRaf.current)
      mapCenterAnimRaf.current = null
    }
  }

  const applyMapCenter = (
    next: { latitude: number; longitude: number },
    opts?: { animate?: boolean },
  ) => {
    if (mapUserGesturingRef.current) return
    mapCenterDisplayRef.current = next
    setMapCenter(next)
    armIgnoreMapRegion(opts?.animate ? MAP_CENTER_EASE_MS + 40 : 50)
  }

  useEffect(() => {
    // 用户拖地图/缩放时，绝不改写中心
    if (mapUserGesturingRef.current) return

    const to = targetMapCenter
    const from = mapCenterDisplayRef.current

    if (suppressCenterFollowRef.current) {
      suppressCenterFollowRef.current = false
      mapCenterDisplayRef.current = to
      return
    }

    cancelMapCenterAnim()

    // 拖拽搜索栏时跟手更新
    if (dragHeightPx != null) {
      applyMapCenter(to)
      return
    }

    if (nearlySameCoord(from, to)) {
      mapCenterDisplayRef.current = to
      return
    }

    const startedAt = Date.now()
    const start = { ...from }
    armIgnoreMapRegion(MAP_CENTER_EASE_MS + 40)

    const tick = () => {
      if (mapUserGesturingRef.current) {
        mapCenterAnimRaf.current = null
        clearIgnoreMapRegion()
        return
      }
      const t = Math.min(1, (Date.now() - startedAt) / MAP_CENTER_EASE_MS)
      const e = easeOutCubic(t)
      const next = {
        latitude: start.latitude + (to.latitude - start.latitude) * e,
        longitude: start.longitude + (to.longitude - start.longitude) * e,
      }
      mapCenterDisplayRef.current = next
      setMapCenter(next)
      if (t < 1) {
        mapCenterAnimRaf.current = requestAnimationFrame(tick)
      } else {
        mapCenterAnimRaf.current = null
      }
    }

    mapCenterAnimRaf.current = requestAnimationFrame(tick)
    return () => {
      cancelMapCenterAnim()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMapCenter, dragHeightPx])

  const rememberLatSpan = (span: number | null | undefined) => {
    if (span == null || !(span > 0)) return
    if (Math.abs(mapViewLatSpanRef.current - span) < 1e-10) {
      mapViewLatSpanRef.current = span
      return
    }
    mapViewLatSpanRef.current = span
    setMapViewLatSpan(span)
  }

  const isUserMapGesture = (causedBy?: string) =>
    causedBy === 'gesture' ||
    causedBy === 'drag' ||
    causedBy === 'scale'

  const onMapRegionChange = (e: {
    type?: string
    causedBy?: string
    detail?: {
      type?: string
      causedBy?: string
      scale?: number
      centerLocation?: { latitude: number; longitude: number }
      latitude?: number
      longitude?: number
      region?: {
        northeast?: { latitude: number; longitude: number }
        southwest?: { latitude: number; longitude: number }
        southeast?: { latitude: number; longitude: number }
      }
    }
  }) => {
    const detail = e.detail || {}
    const type = e.type || detail.type
    const causedBy = e.causedBy || detail.causedBy

    if (type === 'begin') {
      if (isUserMapGesture(causedBy)) {
        // 只打标 + 停动画；手势中禁止 setState，否则受控属性会把拖动拽回去
        mapUserGesturingRef.current = true
        cancelMapCenterAnim()
        clearIgnoreMapRegion()
      }
      return
    }

    if (type !== 'end') return

    const spanFromEvent = readLatSpanFromRegion(detail.region)
    if (spanFromEvent) {
      mapViewLatSpanRef.current = spanFromEvent
    }

    const center =
      detail.centerLocation ||
      (detail.latitude != null && detail.longitude != null
        ? { latitude: detail.latitude, longitude: detail.longitude }
        : null)

    /** 仅缩放手势结束时回写受控 scale；拖动结束回写会触发地图再次应用缩放并略微缩小 */
    const applyZoomScale = (raw?: number) => {
      if (raw == null || !Number.isFinite(raw)) return false
      const next = Math.min(20, Math.max(3, Math.round(raw)))
      mapScaleRef.current = next
      setMapScale((prev) => (prev === next ? prev : next))
      return true
    }

    // 用户手势结束：解除冻结后一次性同步
    if (mapUserGesturingRef.current || isUserMapGesture(causedBy)) {
      const finishGesture = (scaleRaw?: number) => {
        mapUserGesturingRef.current = false
        if (center) {
          const latSpan =
            spanFromEvent ||
            mapViewLatSpanRef.current ||
            estimateMapLatSpan(
              scaleRaw ?? mapScaleRef.current,
              center.latitude,
            )
          const anchor = reverseOffsetCenterForSheet(
            center,
            sheetCoverRatioRef.current,
            latSpan,
          )
          suppressCenterFollowRef.current = true
          mapCenterDisplayRef.current = center
          setMapCenter(center)
          setFocusCoord(anchor)
          if (spanFromEvent) setMapViewLatSpan(spanFromEvent)
        } else if (spanFromEvent) {
          setMapViewLatSpan(spanFromEvent)
        }
        if (causedBy === 'scale') applyZoomScale(scaleRaw)
      }

      if (causedBy === 'scale' && detail.scale == null) {
        try {
          Taro.createMapContext(PLAN_MAP_ID).getScale({
            success: (res) => finishGesture(res.scale),
            fail: () => finishGesture(),
          })
        } catch {
          finishGesture()
        }
        return
      }

      finishGesture(causedBy === 'scale' ? detail.scale : undefined)
      return
    }

    // 程序 update：只更新跨度，不改锚点/中心
    if (causedBy === 'update') {
      if (spanFromEvent) rememberLatSpan(spanFromEvent)
      return
    }
    if (ignoreMapRegionRef.current) return
    if (sheetDraggingRef.current) return
    if (mapCenterAnimRaf.current != null) return
    if (!center) return

    if (spanFromEvent) rememberLatSpan(spanFromEvent)
    const latSpan =
      spanFromEvent ||
      mapViewLatSpanRef.current ||
      estimateMapLatSpan(detail.scale ?? mapScaleRef.current, center.latitude)
    const anchor = reverseOffsetCenterForSheet(
      center,
      sheetCoverRatioRef.current,
      latSpan,
    )
    suppressCenterFollowRef.current = true
    mapCenterDisplayRef.current = center
    setMapCenter(center)
    setFocusCoord(anchor)
    // 非用户手势路径不回写 scale，避免无谓触发地图缩放
  }

  /** 选点前先读取当前地图真实跨度，再设置锚点 */
  const focusCoordOnMap = (
    coord: { latitude: number; longitude: number },
    after?: () => void,
  ) => {
    const apply = (span: number) => {
      mapUserGesturingRef.current = false
      rememberLatSpan(span)
      setFocusCoord(coord)
      setMapUi('preview')
      after?.()
    }

    const fallback = () => {
      apply(
        mapViewLatSpanRef.current ||
          estimateMapLatSpan(mapScaleRef.current, coord.latitude),
      )
    }

    try {
      const ctx = Taro.createMapContext(PLAN_MAP_ID)
      ctx.getRegion({
        success: (res) => {
          const span = Math.abs(
            res.northeast.latitude - res.southwest.latitude,
          )
          if (span > 1e-8) apply(span)
          else fallback()
        },
        fail: fallback,
      })
    } catch {
      fallback()
    }
  }

  const markers = useMemo(() => {
    const list = points.map((p, i) => {
      const index = i + 1
      const selected =
        !!selectedPlace &&
        mapUi === 'preview' &&
        previewKind === 'collected' &&
        isSamePlace(p.place, selectedPlace)
      return {
        id: index,
        latitude: p.place.latitude,
        longitude: p.place.longitude,
        title: p.place.name,
        zIndex: selected ? 10 : 1,
        callout: {
          content: `${index}. ${p.place.name}`,
          display: (selected ? 'ALWAYS' : 'BYCLICK') as 'ALWAYS' | 'BYCLICK',
          padding: 8,
          borderRadius: 6,
          fontSize: selected ? 13 : 12,
        },
      }
    })

    // 搜索钉住的点（尚未在列表中时单独打点；含待移除的取消收藏项）
    if (pinnedSearchPlace && mapUi === 'preview') {
      const alreadyIn = points.some((p) =>
        isSamePlace(p.place, pinnedSearchPlace),
      )
      if (!alreadyIn) {
        const selected = previewKind === 'search'
        list.push({
          id: MARKER_ID_SEARCH,
          latitude: pinnedSearchPlace.latitude,
          longitude: pinnedSearchPlace.longitude,
          title: pinnedSearchPlace.name,
          zIndex: selected ? 10 : 2,
          callout: {
            content: pinnedSearchPlace.name,
            display: (selected ? 'ALWAYS' : 'BYCLICK') as 'ALWAYS' | 'BYCLICK',
            padding: 8,
            borderRadius: 6,
            fontSize: selected ? 13 : 12,
          },
        })
      }
    }

    return list
  }, [points, selectedPlace, pinnedSearchPlace, mapUi, previewKind])

  const ignoreMapClickRef = useRef(false)

  const clearLeaveTimer = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  const PLAN_VIEWS: Array<{ id: PlanView; label: string }> = [
    { id: 'map', label: '地图' },
    { id: 'timeline', label: '时间轴' },
  ]

  const selectPlanView = (next: PlanView) => {
    setViewMenuOpen(false)
    if (next === planView) return
    setLastPlanView(next)
    setPlanView(next)
    // 取消收藏已写入存储，切换视图时把还留在列表里的点去掉
    if (planId && deferredUncollectIds.size > 0) refresh(planId)
  }

  /** 顶部：全屏搜索并聚焦输入框 */
  const goToTop = () => {
    clearLeaveTimer()
    setLeavingSearch(false)
    setDragHeightPx(null)
    setMapUi('searching')
    setInputFocus(false)
    if (focusTimer.current) clearTimeout(focusTimer.current)
    focusTimer.current = setTimeout(() => {
      setInputFocus(true)
    }, 280)
  }

  /** 中部：半屏列表 / 选中点预览 */
  const goToMiddle = () => {
    clearLeaveTimer()
    setLeavingSearch(false)
    setDragHeightPx(null)
    setInputFocus(false)
    Taro.hideKeyboard()
    setMapUi('preview')
  }

  /** 底部：收起搜索栏，并同步延迟取消收藏 */
  const goToBottom = () => {
    setInputFocus(false)
    Taro.hideKeyboard()
    skipBrowseRecenter.current = true
    setDragHeightPx(null)
    setLeavingSearch(true)
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => {
      setLeavingSearch(false)
      setMapUi('browsing')
      setSelectedPlace(null)
      setPinnedSearchPlace(null)
      setKeyword('')
      setResults([])
      setHasSearched(false)
      lastQueryRef.current = ''
      leaveTimer.current = null
      if (planId) refresh(planId)
    }, 320)
  }

  const goToSheet = (pos: SheetPos) => {
    if (pos === 'top') goToTop()
    else if (pos === 'middle') goToMiddle()
    else goToBottom()
  }

  /** 按松手高度吸附：下 1/4 底、上 1/4 顶、中间 1/2 中部 */
  const resolveHeightSnap = (heightPx: number): SheetPos => {
    const minH = sheetHeightPx('bottom')
    const maxH = sheetHeightPx('top')
    const t = (heightPx - minH) / Math.max(maxH - minH, 1)
    if (t < 0.25) return 'bottom'
    if (t < 0.75) return 'middle'
    return 'top'
  }

  const onSheetDragStart = (clientY: number) => {
    const from = mapUiToSheetPos(mapUi, leavingSearch)
    dragRef.current = {
      active: true,
      startY: clientY,
      startH: sheetHeightPx(from),
      from,
    }
    setDragHeightPx(sheetHeightPx(from))
  }

  const onSheetDragMove = (clientY: number) => {
    const drag = dragRef.current
    if (!drag?.active) return
    const dy = clientY - drag.startY
    const minH = sheetHeightPx('bottom')
    const maxH = sheetHeightPx('top')
    const next = Math.min(maxH, Math.max(minH, drag.startH - dy))
    setDragHeightPx(next)
  }

  const onSheetDragEnd = (clientY: number) => {
    const drag = dragRef.current
    if (!drag?.active) return
    dragRef.current = null
    const minH = sheetHeightPx('bottom')
    const maxH = sheetHeightPx('top')
    const endH = Math.min(maxH, Math.max(minH, drag.startH - (clientY - drag.startY)))
    const target = resolveHeightSnap(endH)
    setDragHeightPx(null)
    if (target !== drag.from) {
      goToSheet(target)
    }
  }

  const onSheetTouchStart = (e: {
    touches: Array<{ clientY: number }>
  }) => {
    const y = e.touches[0]?.clientY
    if (y == null) return
    onSheetDragStart(y)
  }

  const onSheetTouchMove = (e: {
    touches: Array<{ clientY: number }>
  }) => {
    const y = e.touches[0]?.clientY
    if (y == null) return
    onSheetDragMove(y)
  }

  const onSheetTouchEnd = (e: {
    changedTouches: Array<{ clientY: number }>
  }) => {
    const y = e.changedTouches[0]?.clientY
    if (y == null) {
      dragRef.current = null
      setDragHeightPx(null)
      return
    }
    onSheetDragEnd(y)
  }

  const mapPoiSeq = useRef(0)

  const onMapPoiTap = (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => {
    const { name, latitude, longitude } = e.detail || {}
    if (latitude == null || longitude == null) return
    const label = name?.trim() || '地图选点'
    ignoreMapClickRef.current = true
    setTimeout(() => {
      ignoreMapClickRef.current = false
    }, 400)

    const seq = ++mapPoiSeq.current
    void lookupMapPlace(label, { latitude, longitude })
      .then((place) => {
        if (seq !== mapPoiSeq.current) return
        onSelectPlace(
          place || {
            name: label,
            address: '',
            latitude,
            longitude,
          },
        )
      })
      .catch(() => {
        if (seq !== mapPoiSeq.current) return
        onSelectPlace({
          name: label,
          address: '',
          latitude,
          longitude,
        })
      })
  }

  const onSelectPlace = (item: PlaceInfo) => {
    clearLeaveTimer()
    setLeavingSearch(false)
    setDragHeightPx(null)
    setInputFocus(false)
    setPinnedSearchPlace(item)
    setSelectedPlace(item)
    setPreviewKind('search')
    // 搜索选点会改缩放，跨度用新 scale 估算；随后 regionchange 会校正
    const nextScale = 15
    setMapScale(nextScale)
    mapScaleRef.current = nextScale
    rememberLatSpan(estimateMapLatSpan(nextScale, item.latitude))
    setFocusCoord({ latitude: item.latitude, longitude: item.longitude })
    setMapUi('preview')
    Taro.hideKeyboard()
  }

  const focusPinnedSearchPlace = () => {
    if (!pinnedSearchPlace) return
    setSelectedPlace(pinnedSearchPlace)
    setPreviewKind('search')
    focusCoordOnMap({
      latitude: pinnedSearchPlace.latitude,
      longitude: pinnedSearchPlace.longitude,
    })
  }

  const onKeywordInput = (value: string) => {
    setKeyword(value)
    if (mapUi !== 'searching') {
      setMapUi('searching')
    }
  }

  const markDeferredUncollect = (point: TargetPoint) => {
    deletePoint(point.id)
    setDeferredUncollectIds((prev) => new Set(prev).add(point.id))
    if (planId) refreshPlanMeta(planId)
    Taro.showToast({ title: '已取消收藏', icon: 'success' })
  }

  const recollectDeferredPoint = (point: TargetPoint) => {
    if (!planId) return
    try {
      const created = createPoint({
        planId,
        place: point.place,
        expectedAt: point.expectedAt,
      })
      setDeferredUncollectIds((prev) => {
        const next = new Set(prev)
        next.delete(point.id)
        return next
      })
      setPoints((prev) => prev.map((p) => (p.id === point.id ? created : p)))
      refreshPlanMeta(planId)
      Taro.showToast({ title: '已收藏', icon: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  const onToggleCollect = () => {
    if (!pinnedSearchPlace || !planId) return

    if (collectedPoint) {
      markDeferredUncollect(collectedPoint)
      return
    }

    const deferredSame = points.find(
      (p) =>
        isSamePlace(p.place, pinnedSearchPlace) &&
        deferredUncollectIds.has(p.id),
    )
    if (deferredSame) {
      recollectDeferredPoint(deferredSame)
      return
    }

    try {
      const created = createPoint({
        planId,
        place: pinnedSearchPlace,
        expectedAt: new Date().toISOString(),
      })
      setPoints((prev) => [...prev, created])
      refreshPlanMeta(planId)
      Taro.showToast({ title: '已收藏', icon: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  const onToggleCollectedListStar = (point: TargetPoint) => {
    if (!planId) return
    if (deferredUncollectIds.has(point.id)) {
      recollectDeferredPoint(point)
      return
    }
    markDeferredUncollect(point)
  }

  const scrollToCollectedPoint = (pointId: string) => {
    const targetId = `collected-${pointId}`
    // 先清空再设置，保证重复点击同一项也能滚动
    setScrollIntoView('')
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      setScrollIntoView(targetId)
      scrollTimer.current = setTimeout(() => {
        setScrollIntoView('')
        scrollTimer.current = null
      }, 400)
    }, 80)
  }

  const focusPointOnMap = (point: TargetPoint) => {
    clearLeaveTimer()
    setLeavingSearch(false)
    setDragHeightPx(null)
    setInputFocus(false)
    setSelectedPlace(point.place)
    setPreviewKind('collected')
    // 不清理 pinnedSearchPlace：搜索选中点仍留在列表上方，仅取消高亮
    focusCoordOnMap(
      {
        latitude: point.place.latitude,
        longitude: point.place.longitude,
      },
      () => scrollToCollectedPoint(point.id),
    )
  }

  const onMarkerTap = (e: { detail: { markerId: number | string } }) => {
    const markerId = Number(e.detail.markerId)
    ignoreMapClickRef.current = true
    setTimeout(() => {
      ignoreMapClickRef.current = false
    }, 400)

    if (markerId === MARKER_ID_SEARCH) {
      focusPinnedSearchPlace()
      return
    }

    const point = points[markerId - 1]
    if (point) {
      focusPointOnMap(point)
    }
  }

  const onMapRegionChangeRef = useRef(onMapRegionChange)
  onMapRegionChangeRef.current = onMapRegionChange
  const onMarkerTapRef = useRef(onMarkerTap)
  onMarkerTapRef.current = onMarkerTap
  const onMapPoiTapRef = useRef(onMapPoiTap)
  onMapPoiTapRef.current = onMapPoiTap
  const sheetPosRef = useRef(sheetPos)
  sheetPosRef.current = sheetPos
  const goToBottomRef = useRef(goToBottom)
  goToBottomRef.current = goToBottom

  const stableOnRegionChange = useCallback(
    (e: {
      type?: string
      causedBy?: string
      detail?: Record<string, unknown>
    }) => {
      onMapRegionChangeRef.current(e as never)
    },
    [],
  )
  const stableOnMarkerTap = useCallback(
    (e: { detail: { markerId: number | string } }) => {
      onMarkerTapRef.current(e)
    },
    [],
  )
  const stableOnPoiTap = useCallback(
    (e: {
      detail: { name?: string; latitude?: number; longitude?: number }
    }) => {
      onMapPoiTapRef.current(e)
    },
    [],
  )
  const stableOnMapClick = useCallback(() => {
    if (ignoreMapClickRef.current) return
    if (sheetPosRef.current === 'middle') goToBottomRef.current()
  }, [])

  const inSearchUi = mapUi === 'searching' || leavingSearch
  const showSheetBody = sheetPos !== 'bottom' || dragHeightPx != null

  const showSearchResults =
    sheetPos === 'top' && (results.length > 0 || searching || hasSearched)

  const sheetClass = [
    'sheet',
    sheetPos === 'top' ? 'sheet--top' : '',
    sheetPos === 'middle' ? 'sheet--middle' : '',
    sheetPos === 'bottom' ? 'sheet--bottom' : '',
    dragHeightPx != null ? 'sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!plan) {
    return (
      <View className='detail'>
        <View className='empty'>计划不存在或已删除</View>
      </View>
    )
  }

  return (
    <View className={`detail ${planView === 'map' ? 'detail--map' : 'detail--timeline'}`}>
      {planView === 'map' ? (
      <View className='map-stage'>
        <PlanMap
          latitude={mapCenter.latitude}
          longitude={mapCenter.longitude}
          scale={mapScale}
          markers={markers as Array<Record<string, unknown>>}
          onRegionChange={stableOnRegionChange}
          onMarkertap={stableOnMarkerTap}
          onPoiTap={stableOnPoiTap}
          onClick={stableOnMapClick}
        />

        <View
          className={sheetClass}
          style={dragHeightPx != null ? { height: `${dragHeightPx}px` } : undefined}
        >
          <View
            className='sheet__grab'
            catchMove
            onTouchStart={onSheetTouchStart}
            onTouchMove={onSheetTouchMove}
            onTouchEnd={onSheetTouchEnd}
            onTouchCancel={onSheetTouchEnd}
          >
            <View className='sheet__handle'>
              <View className='sheet__handle-bar' />
            </View>

            {sheetPos === 'top' ? (
              <View className='sheet__search-bar'>
                <View
                  className='sheet__cancel'
                  onClick={(e) => {
                    e.stopPropagation()
                    goToBottom()
                  }}
                >
                  取消
                </View>
                <View className='sheet__input-wrap'>
                  <Input
                    className='sheet__input'
                    value={keyword}
                    focus={inputFocus}
                    placeholder='搜索地点'
                    confirmType='search'
                    onInput={(e) => onKeywordInput(e.detail.value)}
                  />
                </View>
              </View>
            ) : (
              <View className='sheet__search-wrap'>
                <View
                  className='sheet__search'
                  onClick={(e) => {
                    e.stopPropagation()
                    goToTop()
                  }}
                >
                  <Text
                    className={`sheet__input-text ${
                      keyword ? '' : 'sheet__input-text--placeholder'
                    }`}
                  >
                    {keyword || '搜索地点'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {showSheetBody && (
            <ScrollView
              scrollY
              className='sheet__body'
              enhanced
              showScrollbar
              scrollWithAnimation
              scrollIntoView={scrollIntoView}
            >
              <View className='sheet__body-inner'>
              {/* 搜索选中点固定在搜索框与已收藏之间；点其他点时取消高亮但不移除 */}
              {(sheetPos === 'middle' || mapUi === 'preview') && pinnedSearchPlace && (
                <View
                  className={`place-card ${
                    previewKind === 'search' ? 'place-card--active' : ''
                  }`}
                  onClick={focusPinnedSearchPlace}
                >
                  <View className='place-card__info'>
                    <View className='place-card__name'>
                      {pinnedSearchPlace.name}
                    </View>
                    <View className='place-card__addr'>
                      {pinnedSearchPlace.address}
                    </View>
                    {(pinnedSearchPlace.city ||
                      pinnedSearchPlace.distanceMeters != null) && (
                      <View className='place-card__meta'>
                        {[
                          pinnedSearchPlace.city,
                          formatDistance(pinnedSearchPlace.distanceMeters),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </View>
                    )}
                  </View>
                  <View
                    className='collect-star'
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleCollect()
                    }}
                  >
                    <Star
                      size={18}
                      color='#eab308'
                      filled={!!collectedPoint}
                    />
                  </View>
                </View>
              )}

              {showSearchResults && (
                <View className='result-block'>
                  <View className='sheet__section-title'>
                    {searching ? '搜索中…' : '搜索结果'}
                  </View>
                  {!searching && hasSearched && results.length === 0 && (
                    <View className='sheet__empty'>未找到相关地点</View>
                  )}
                  {results.map((item) => (
                    <View
                      key={`${item.poiId || item.name}-${item.longitude}-${item.latitude}`}
                      className='result-item'
                      onClick={() => onSelectPlace(item)}
                    >
                      <View className='result-item__main'>
                        <View className='result-item__name'>{item.name}</View>
                        <View className='result-item__addr'>{item.address}</View>
                      </View>
                      {!!formatDistance(item.distanceMeters) && (
                        <View className='result-item__dist'>
                          {formatDistance(item.distanceMeters)}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <View className='sheet__section-title'>
                已收藏（{points.length}）
              </View>
              {points.length === 0 ? (
                <View className='sheet__empty'>
                  {inSearchUi
                    ? '暂无收藏，搜索地点后可加入'
                    : '暂无目标点，可收藏当前地点'}
                </View>
              ) : (
                points.map((point, index) => {
                  const collected = !deferredUncollectIds.has(point.id)
                  const active =
                    mapUi === 'preview' &&
                    previewKind === 'collected' &&
                    !!selectedPlace &&
                    isSamePlace(point.place, selectedPlace)
                  return (
                  <View
                    id={`collected-${point.id}`}
                    key={point.id}
                    className={`sheet-point ${
                      active ? 'sheet-point--active' : ''
                    }`}
                    onClick={() => focusPointOnMap(point)}
                  >
                    <Text className='sheet-point__index'>{index + 1}</Text>
                    <View className='sheet-point__body'>
                      <View className='sheet-point__name'>
                        {point.place.name}
                      </View>
                      <View className='sheet-point__addr'>
                        {point.place.address}
                      </View>
                      <View className='sheet-point__time'>
                        {formatDateTime(point.expectedAt)}
                      </View>
                      {!!point.noteText && (
                        <View className='sheet-point__note'>{point.noteText}</View>
                      )}
                    </View>
                    <View
                      className='sheet-point__actions'
                      onClick={(e) => e.stopPropagation()}
                    >
                      <View
                        className='nav-entry'
                        onClick={() => {
                          Taro.navigateTo({
                            url: `/pages/nav/index?pointId=${point.id}`,
                          })
                        }}
                      >
                        <Navigation size={16} color='#1a5f4a' />
                      </View>
                      <View
                        className='edit-entry'
                        onClick={() => {
                          Taro.navigateTo({
                            url: `/pages/point-note/index?pointId=${point.id}`,
                          })
                        }}
                      >
                        <SquarePen size={16} color='#1a5f4a' />
                      </View>
                      <View
                        className='collect-star'
                        onClick={() => onToggleCollectedListStar(point)}
                      >
                        <Star
                          size={18}
                          color='#eab308'
                          filled={collected}
                        />
                      </View>
                    </View>
                  </View>
                  )
                })
              )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
      ) : (
        <View className='timeline-view'>
          <View className='timeline-view__hero'>
            <Text className='timeline-view__title'>{plan.name}</Text>
            {!!plan.description ? (
              <Text className='timeline-view__desc'>{plan.description}</Text>
            ) : (
              <Text className='timeline-view__desc timeline-view__desc--muted'>
                暂无描述
              </Text>
            )}
            <View className='timeline-view__meta'>
              {points.length} 个收藏点 · 更新于 {formatDateTime(plan.updatedAt)}
            </View>
          </View>

          <ScrollView scrollY enhanced usingSticky className='timeline-view__scroll'>
            {points.length === 0 ? (
              <View className='timeline-view__empty'>还没有收藏地点</View>
            ) : (
              <View className='timeline'>
                {groupPointsByYear(points).map((year, yearIndex, years) => (
                  <View key={year.key} className='timeline__year'>
                    <View className='timeline__sticky timeline__sticky--year'>
                      <View className='timeline__item timeline__item--year'>
                        <View className='timeline__rail'>
                          <View
                            className={`timeline__line${
                              yearIndex === 0 ? ' timeline__line--start' : ''
                            }`}
                          />
                          <View className='timeline__dot timeline__dot--year' />
                        </View>
                        <View className='timeline__year-label'>{year.label}</View>
                      </View>
                    </View>
                    {year.days.map((day, dayIndex) => {
                  const isLastDay =
                    yearIndex === years.length - 1 &&
                    dayIndex === year.days.length - 1
                  return (
                  <View key={day.key} className='timeline__day-group'>
                    <View className='timeline__sticky timeline__sticky--day'>
                      <View className='timeline__item timeline__item--day'>
                        <View className='timeline__rail'>
                          <View
                            className={`timeline__line${
                              isLastDay && day.points.length === 0
                                ? ' timeline__line--end-day'
                                : ''
                            }`}
                          />
                          <View className='timeline__dot timeline__dot--day' />
                        </View>
                        <View className='timeline__day'>
                          {day.label}
                          <Text className='timeline__weekday'>{day.weekday}</Text>
                        </View>
                      </View>
                    </View>
                    {day.points.map((point, index) => {
                  const collected = !deferredUncollectIds.has(point.id)
                  const axisMark = placeAxisMark(point.place)
                  const AxisIcon = axisMark.icon
                  const isLast =
                    yearIndex === years.length - 1 &&
                    dayIndex === year.days.length - 1 &&
                    index === day.points.length - 1
                  return (
                  <View
                    key={point.id}
                    className={`timeline__item${
                      isLast ? ' timeline__item--last' : ''
                    }`}
                  >
                    <View className='timeline__rail'>
                      <View
                        className={`timeline__line${
                          isLast ? ' timeline__line--end' : ''
                        }`}
                      />
                      <View
                        className='timeline__dot timeline__dot--point'
                        style={{ backgroundColor: lightenColor(axisMark.color) }}
                      >
                        <AxisIcon size={14} color={axisMark.color} />
                      </View>
                    </View>
                    <View
                      className={`timeline__card${
                        expandedId === point.id ? ' timeline__card--open' : ''
                      }`}
                      onClick={() =>
                        setExpandedId((cur) => (cur === point.id ? '' : point.id))
                      }
                    >
                      <View className='timeline__head'>
                        <View className='timeline__main'>
                          <View className='timeline__time'>
                            {formatClock(point.expectedAt)}
                          </View>
                          <View className='timeline__name'>{point.place.name}</View>
                          {!!point.place.address && (
                            <View className='timeline__addr'>
                              {point.place.address}
                            </View>
                          )}
                        </View>
                        <View
                          className='timeline__nav'
                          onClick={(e) => {
                            e.stopPropagation()
                            Taro.navigateTo({
                              url: `/pages/nav/index?pointId=${point.id}`,
                            })
                          }}
                        >
                          <Navigation size={16} color='#1a5f4a' />
                        </View>
                        <View
                          className='collect-star'
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleCollectedListStar(point)
                          }}
                        >
                          <Star
                            size={18}
                            color='#eab308'
                            filled={collected}
                          />
                        </View>
                      </View>
                      <View className='timeline__detail'>
                        <View className='timeline__detail-inner'>
                          {placeInfoRows(point.place).map((row) => (
                            <View key={row.label} className='timeline__info-row'>
                              <View className='timeline__info-label'>{row.label}</View>
                              <View className='timeline__info-value'>{row.value}</View>
                            </View>
                          ))}
                          <View className='timeline__detail-label'>备注</View>
                          {point.noteHtml?.trim() ? (
                            <RichText
                              className='timeline__detail-html'
                              nodes={point.noteHtml}
                            />
                          ) : point.noteText?.trim() ? (
                            <View className='timeline__detail-text'>
                              {point.noteText}
                            </View>
                          ) : (
                            <View className='timeline__detail-empty'>暂无备注</View>
                          )}
                        </View>
                      </View>
                    </View>
                  </View>
                  )
                })}
                  </View>
                  )
                  })}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      <View className='map-fab map-fab--right' onClick={() => setViewMenuOpen((open) => !open)}>
        {planView === 'map' ? (
          <MapPinned size={16} color='#1a5f4a' />
        ) : (
          <ListTree size={16} color='#1a5f4a' />
        )}
      </View>
      {viewMenuOpen && (
        <View className='view-menu'>
          <View
            className='view-menu__mask'
            onClick={() => setViewMenuOpen(false)}
          />
          <View className='view-menu__panel'>
            {PLAN_VIEWS.map((item) => {
              const active = item.id === planView
              return (
                <View
                  key={item.id}
                  className={`view-menu__item${active ? ' view-menu__item--active' : ''}`}
                  onClick={() => selectPlanView(item.id)}
                >
                  {item.id === 'map' ? (
                    <MapPinned size={16} color={active ? '#1a5f4a' : '#646a73'} />
                  ) : (
                    <ListTree size={16} color={active ? '#1a5f4a' : '#646a73'} />
                  )}
                  <Text className='view-menu__label'>{item.label}</Text>
                </View>
              )
            })}
          </View>
        </View>
      )}

    </View>
  )
}

import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { PlaceInfo, TargetPoint, TravelPlan } from '../../types'
import {
  distanceMeters,
  getUserLocation,
  lookupMapPlace,
  searchPlaces,
} from '../../services/amap'
import type { UserLocation } from '../../services/amap'
import {
  createPoint,
  deletePoint,
  getPlan,
  getLastPlanView,
  listPointsByPlan,
  setLastPlanView,
  updatePointExpectedAt,
} from '../../services/storage'
import {
  DEFAULT_CENTER,
  MAP_CENTER_EASE_MS,
  MARKER_ID_SEARCH,
  SEARCH_DEBOUNCE_MS,
  coverRatioFromSheetHeight,
  easeOutCubic,
  estimateMapLatSpan,
  fitMapToPoints,
  mapUiToSheetPos,
  nearlySameCoord,
  offsetCenterForSheet,
  readLatSpanFromRegion,
  reverseOffsetCenterForSheet,
  sheetHeightPx,
} from './map-geometry'
import { isSamePlace } from './place-info'
import { markerIconPath } from './place-axis'
import { PLAN_MAP_ID, mapUserGesturingRef } from './PlanMap'
import { MapStage } from './MapStage'
import { TimelineView } from './TimelineView'
import { ViewSwitch } from './ViewSwitch'
import type { MapUiMode, PlanView, PreviewKind, SheetPos } from './types'
import './index.scss'

/** 小于该位移视为点按，不算拖拽 */
const SHEET_TAP_SLOP_PX = 10

/** 画布与 scripts/generate-markers.mjs 的 PAD 一致：左 200、上 200、右 200、下 220 */
const MARKER_CANVAS = { width: 1424, height: 1444 }
/** 针尖在原图 (512, 1018.56)，外发光留白后不再贴底边 */
const MARKER_ANCHOR = { x: 0.5, y: (1018.56 + 200) / MARKER_CANVAS.height }

function placeMarkerIcon(place: PlaceInfo, selected: boolean) {
  const width = selected ? 58 : 50
  return {
    iconPath: markerIconPath(place),
    width,
    height: Math.round((width * MARKER_CANVAS.height) / MARKER_CANVAS.width),
    anchor: MARKER_ANCHOR,
  }
}

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
  /** 地图点选出来的地点，展示在搜索结果和已收藏之上 */
  const [mapPickedPlace, setMapPickedPlace] = useState<PlaceInfo | null>(null)

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
  const [focusCardId, setFocusCardId] = useState('')
  /** 已从存储删除、但仍在列表中展示的点，等底栏收起后再同步列表 */
  const [deferredUncollectIds, setDeferredUncollectIds] = useState<Set<string>>(
    () => new Set(),
  )

  const searchSeq = useRef(0)
  const skipBrowseRecenter = useRef(false)
  /** 搜索选点改缩放时，随后的 region 只用来校正视野，不当成用户缩放 */
  const ownMapMoveRef = useRef(false)
  const selectSpanSeq = useRef(0)
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
  /** 本次手势是否已离开点按范围，用来区分拖拽和聚焦 */
  const dragMovedRef = useRef(false)
  const focusScrollPendingRef = useRef(false)
  const ignoreFocusScrollUntilRef = useRef(0)
  /** 拖拽松手后紧跟的 click 不再当成点搜索框 */
  const suppressNextSearchClickRef = useRef(false)
  /** 主动聚焦后短时间内的 blur 不撤销焦点 */
  const ignoreBlurUntilRef = useRef(0)
  const mapCenterDisplayRef = useRef(DEFAULT_CENTER)
  /** 搜索用当前地图关注点，不放进 effect 依赖，避免平移打断防抖 */
  const focusCoordRef = useRef(DEFAULT_CENTER)
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
      searchSeq.current += 1
      lastQueryRef.current = ''
      setResults((prev) => (prev.length === 0 ? prev : []))
      setSearching(false)
      setHasSearched(false)
      return
    }

    // 同一关键词已搜过时不重复请求，避免结果条数变化把 effect 再跑一遍
    if (lastQueryRef.current === q) return

    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      if (seq !== searchSeq.current) return
      setSearching(true)
      try {
        const list = await searchPlaces(q, {
          mapCenter: focusCoordRef.current,
          from: userLocation,
        })
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
  }, [keyword, userLocation, mapUi, leavingSearch])

  const defaultExpectedAt = () => {
    let latest: TargetPoint | null = null
    for (const point of points) {
      if (!latest || point.createdAt > latest.createdAt) latest = point
    }
    return latest?.expectedAt || new Date().toISOString()
  }

  const collectPlace = (place: PlaceInfo) => {
    if (!planId) return
    const existing = points.find(
      (p) => isSamePlace(p.place, place) && !deferredUncollectIds.has(p.id),
    )
    if (existing) {
      markDeferredUncollect(existing)
      return
    }
    const deferredSame = points.find(
      (p) => isSamePlace(p.place, place) && deferredUncollectIds.has(p.id),
    )
    if (deferredSame) {
      recollectDeferredPoint(deferredSame)
      return
    }
    try {
      const created = createPoint({
        planId,
        place,
        expectedAt: defaultExpectedAt(),
      })
      setPoints((prev) => [...prev, created])
      refreshPlanMeta(planId)
      Taro.showToast({ title: '已收藏', icon: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  const sheetPos = mapUiToSheetPos(mapUi, leavingSearch)

  const sheetHeightNow =
    dragHeightPx != null ? dragHeightPx : sheetHeightPx(sheetPos)
  const sheetCoverRatio = coverRatioFromSheetHeight(sheetHeightNow)
  sheetCoverRatioRef.current = sheetCoverRatio
  mapScaleRef.current = mapScale
  focusCoordRef.current = focusCoord
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

    // 用户手势结束：解除冻结后一次性同步。程序改缩放也会带 causedBy=scale，不能走这里
    if (
      mapUserGesturingRef.current ||
      (isUserMapGesture(causedBy) && !ownMapMoveRef.current)
    ) {
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

    // 程序改中心/缩放：只刷新真实跨度，让中部底栏偏移重算，不把锚点锁回全屏中心
    if (
      ownMapMoveRef.current ||
      causedBy === 'update' ||
      causedBy === 'scale'
    ) {
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
        ...placeMarkerIcon(p.place, selected),
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
          ...placeMarkerIcon(pinnedSearchPlace, selected),
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

  const clearFocusTimer = () => {
    if (focusTimer.current) {
      clearTimeout(focusTimer.current)
      focusTimer.current = null
    }
  }

  const selectPlanView = (next: PlanView) => {
    setViewMenuOpen(false)
    if (next === planView) return
    setLastPlanView(next)
    setPlanView(next)
    // 取消收藏已写入存储，切换视图时把还留在列表里的点去掉
    if (planId && deferredUncollectIds.size > 0) refresh(planId)
  }

  /** 只改搜索框档位，不碰焦点 */
  const moveSheet = (pos: SheetPos) => {
    if (pos === 'top') {
      clearLeaveTimer()
      setLeavingSearch(false)
      setDragHeightPx(null)
      setMapUi('searching')
      return
    }
    if (pos === 'middle') {
      clearLeaveTimer()
      setLeavingSearch(false)
      setDragHeightPx(null)
      setMapUi('preview')
      return
    }
    skipBrowseRecenter.current = true
    setDragHeightPx(null)
    setLeavingSearch(true)
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => {
      setLeavingSearch(false)
      setMapUi('browsing')
      setSelectedPlace(null)
      setPinnedSearchPlace(null)
      setMapPickedPlace(null)
      setKeyword('')
      setResults([])
      setHasSearched(false)
      lastQueryRef.current = ''
      leaveTimer.current = null
      if (planId) refresh(planId)
    }, 320)
  }

  const clearInputFocus = () => {
    clearFocusTimer()
    setInputFocus(false)
    Taro.hideKeyboard()
  }

  const focusInput = (
    delayMs: number,
    options?: { holdBlur?: boolean; then?: () => void },
  ) => {
    clearFocusTimer()
    if (options?.holdBlur) ignoreBlurUntilRef.current = Date.now() + 400
    setInputFocus(false)
    focusTimer.current = setTimeout(() => {
      setInputFocus(true)
      focusTimer.current = null
      options?.then?.()
    }, delayMs)
  }

  /** 点击搜索框 / 添加地点：先到顶部，再聚焦 */
  const openSearch = () => {
    moveSheet('top')
    focusInput(280, { then: scrollSheetToTop })
  }

  const onSearchBoxTap = () => {
    if (suppressNextSearchClickRef.current) return
    if (mapUi !== 'searching') {
      openSearch()
      return
    }
    if (!inputFocus) focusInput(50, { holdBlur: true })
    scrollSheetToTop()
  }

  const dismissSheet = () => {
    clearInputFocus()
    moveSheet('bottom')
  }

  const openMapToAdd = () => {
    setViewMenuOpen(false)
    setLastPlanView('map')
    setPlanView('map')
    if (planId && deferredUncollectIds.size > 0) refresh(planId)
    openSearch()
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
    ignoreFocusScrollUntilRef.current = 0
    dragMovedRef.current = false
    focusScrollPendingRef.current = false
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
    if (Math.abs(dy) > SHEET_TAP_SLOP_PX) {
      dragMovedRef.current = true
      focusScrollPendingRef.current = false
    }
    const minH = sheetHeightPx('bottom')
    const maxH = sheetHeightPx('top')
    const next = Math.min(maxH, Math.max(minH, drag.startH - dy))
    setDragHeightPx(next)
  }

  const onSheetDragEnd = (clientY: number) => {
    const drag = dragRef.current
    if (!drag?.active) return
    dragRef.current = null
    const moved =
      dragMovedRef.current ||
      Math.abs(clientY - drag.startY) > SHEET_TAP_SLOP_PX
    dragMovedRef.current = false
    if (moved) {
      // 松手后输入框可能才 focus，这段时间内的 focus 不算点按
      ignoreFocusScrollUntilRef.current = Date.now() + 300
      focusScrollPendingRef.current = false
      suppressNextSearchClickRef.current = true
      setTimeout(() => {
        suppressNextSearchClickRef.current = false
      }, 350)
      clearInputFocus()
    } else if (focusScrollPendingRef.current) {
      focusScrollPendingRef.current = false
      if (mapUi !== 'searching') openSearch()
      else if (!inputFocus) {
        focusInput(50, { holdBlur: true })
        scrollSheetToTop()
      }
    }
    const minH = sheetHeightPx('bottom')
    const maxH = sheetHeightPx('top')
    const endH = Math.min(maxH, Math.max(minH, drag.startH - (clientY - drag.startY)))
    const target = resolveHeightSnap(endH)
    setDragHeightPx(null)
    if (moved && target !== drag.from) {
      moveSheet(target)
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
      dragMovedRef.current = false
      focusScrollPendingRef.current = false
      setDragHeightPx(null)
      return
    }
    onSheetDragEnd(y)
  }

  const mapPoiSeq = useRef(0)

  const placeFromMap = (place: PlaceInfo): PlaceInfo => {
    if (!userLocation) return place
    return {
      ...place,
      distanceMeters: distanceMeters(userLocation, place),
    }
  }

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

    const fallback: PlaceInfo = {
      name: label,
      address: '',
      latitude,
      longitude,
    }
    const seq = ++mapPoiSeq.current
    onSelectPlace(fallback, 'map')
    void lookupMapPlace(label, { latitude, longitude })
      .then((place) => {
        if (seq !== mapPoiSeq.current || !place) return
        const next = placeFromMap(place)
        setMapPickedPlace(next)
        setPinnedSearchPlace(next)
        setSelectedPlace(next)
        if (
          !nearlySameCoord(
            { latitude: next.latitude, longitude: next.longitude },
            { latitude, longitude },
          )
        ) {
          setFocusCoord({ latitude: next.latitude, longitude: next.longitude })
        }
      })
      .catch(() => {
        // 详情补齐失败时保留点选时的名称和坐标
      })
  }

  const refreshLatSpanFromMap = (seq: number) => {
    try {
      Taro.createMapContext(PLAN_MAP_ID).getRegion({
        success: (res) => {
          if (seq !== selectSpanSeq.current) return
          const span = Math.abs(res.northeast.latitude - res.southwest.latitude)
          if (span > 1e-8) rememberLatSpan(span)
        },
      })
    } catch {
      // 地图尚未就绪时保留估算跨度
    }
  }

  const onSelectPlace = (item: PlaceInfo, source: 'map' | 'list' = 'list') => {
    clearInputFocus()
    moveSheet('middle')
    const next = source === 'map' ? placeFromMap(item) : item
    setPinnedSearchPlace(next)
    setSelectedPlace(next)
    setPreviewKind('search')
    setMapPickedPlace(source === 'map' ? next : null)
    if (source === 'map') revealSelectedPlace(next)
    const nextScale = 15
    const seq = ++selectSpanSeq.current
    ownMapMoveRef.current = true
    setMapScale(nextScale)
    mapScaleRef.current = nextScale
    // 先用新缩放估算，让中部偏移马上生效；缩放落地后再用真实视野校正
    rememberLatSpan(estimateMapLatSpan(nextScale, item.latitude))
    setFocusCoord({ latitude: item.latitude, longitude: item.longitude })
    setTimeout(() => {
      refreshLatSpanFromMap(seq)
      if (seq === selectSpanSeq.current) ownMapMoveRef.current = false
    }, MAP_CENTER_EASE_MS + 80)
  }

  const focusPinnedSearchPlace = () => {
    if (!pinnedSearchPlace) return
    const next = placeFromMap(pinnedSearchPlace)
    setMapPickedPlace(next)
    setSelectedPlace(next)
    setPreviewKind('search')
    focusCoordOnMap({
      latitude: next.latitude,
      longitude: next.longitude,
    })
    revealSelectedPlace(next)
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

  const scrollSheetToTop = () => {
    setScrollIntoView('')
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      setScrollIntoView('sheet-scroll-top')
      scrollTimer.current = setTimeout(() => {
        setScrollIntoView('')
        scrollTimer.current = null
      }, 400)
    }, 80)
  }

  const onSearchFocus = () => {
    if (Date.now() < ignoreFocusScrollUntilRef.current) return
    if (dragRef.current?.active) {
      focusScrollPendingRef.current = true
      return
    }
    // 已在顶部时不要再 focusInput，否则 onFocus 会把焦点反复关掉再打开，光标一直闪
    if (mapUi !== 'searching') openSearch()
  }

  useEffect(() => {
    if (mapUi !== 'searching' || leavingSearch) return
    scrollSheetToTop()
    // 只在搜索结果变化时滚回顶部
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  const onToggleCollectedListStar = (point: TargetPoint) => {
    if (!planId) return
    if (deferredUncollectIds.has(point.id)) {
      recollectDeferredPoint(point)
      return
    }
    markDeferredUncollect(point)
  }

  const scrollSheetTarget = (targetId: string) => {
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

  const scrollToCollectedPoint = (pointId: string) => {
    scrollSheetTarget(`collected-${pointId}`)
  }

  const revealSelectedPlace = (place: PlaceInfo) => {
    const resultIndex = results.findIndex((item) => isSamePlace(item, place))
    if (resultIndex >= 0) {
      scrollSheetTarget(`search-result-${resultIndex}`)
      return
    }
    const collected = points.find((point) => isSamePlace(point.place, place))
    if (collected) {
      scrollToCollectedPoint(collected.id)
      return
    }
    scrollSheetToTop()
  }

  const focusPointOnMap = (
    point: TargetPoint,
    source: 'map' | 'list' = 'list',
  ) => {
    clearInputFocus()
    moveSheet('middle')
    setSelectedPlace(point.place)
    setPreviewKind('collected')
    // 不清理 pinnedSearchPlace：地图搜索点保留，搜索结果只取消高亮
    if (source === 'map') {
      setMapPickedPlace(placeFromMap(point.place))
    } else {
      setMapPickedPlace(null)
    }
    focusCoordOnMap(
      {
        latitude: point.place.latitude,
        longitude: point.place.longitude,
      },
      source === 'map'
        ? () => revealSelectedPlace(point.place)
        : () => scrollToCollectedPoint(point.id),
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
      focusPointOnMap(point, 'map')
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
  const dismissSheetRef = useRef(dismissSheet)
  dismissSheetRef.current = dismissSheet

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
    if (sheetPosRef.current === 'middle') dismissSheetRef.current()
  }, [])

  const inSearchUi = mapUi === 'searching' || leavingSearch
  const showSheetBody = sheetPos !== 'bottom' || dragHeightPx != null

  const showSearchResults =
    sheetPos !== 'bottom' && (results.length > 0 || searching || hasSearched)

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
        <MapStage
          mapCenter={mapCenter}
          mapScale={mapScale}
          markers={markers as Array<Record<string, unknown>>}
          onRegionChange={stableOnRegionChange}
          onMarkerTap={stableOnMarkerTap}
          onPoiTap={stableOnPoiTap}
          onMapClick={stableOnMapClick}
          sheetClass={sheetClass}
          dragHeightPx={dragHeightPx}
          onSheetTouchStart={onSheetTouchStart}
          onSheetTouchMove={onSheetTouchMove}
          onSheetTouchEnd={onSheetTouchEnd}
          sheetPos={sheetPos}
          goToBottom={dismissSheet}
          goToTop={onSearchBoxTap}
          keyword={keyword}
          inputFocus={inputFocus}
          onKeywordInput={onKeywordInput}
          onSearchFocus={onSearchFocus}
          onSearchBlur={() => {
            if (focusTimer.current) return
            if (Date.now() < ignoreBlurUntilRef.current) return
            setInputFocus(false)
          }}
          onCollectSearchPlace={collectPlace}
          showSheetBody={showSheetBody}
          scrollIntoView={scrollIntoView}
          mapUi={mapUi}
          previewKind={previewKind}
          showSearchResults={showSearchResults}
          searching={searching}
          hasSearched={hasSearched}
          results={results}
          onSelectPlace={onSelectPlace}
          points={points}
          inSearchUi={inSearchUi}
          deferredUncollectIds={deferredUncollectIds}
          selectedPlace={selectedPlace}
          mapPickedPlace={mapPickedPlace}
          focusPointOnMap={focusPointOnMap}
          onToggleCollectedListStar={onToggleCollectedListStar}
        />
      ) : (
        <TimelineView
          plan={plan}
          points={points}
          expandedId={expandedId}
          focusCardId={focusCardId}
          deferredUncollectIds={deferredUncollectIds}
          onToggleExpanded={(id) => setExpandedId(id)}
          onToggleCollected={onToggleCollectedListStar}
          onReschedule={(pointId, expectedAt) => {
            const updated = updatePointExpectedAt(pointId, expectedAt)
            if (!updated || !planId) {
              Taro.showToast({ title: '时间未保存', icon: 'none' })
              return
            }
            setPoints(listPointsByPlan(planId))
            refreshPlanMeta(planId)
            setFocusCardId('')
            setTimeout(() => setFocusCardId(pointId), 80)
          }}
        />
      )}
      <ViewSwitch
        planView={planView}
        open={viewMenuOpen}
        onToggle={() => setViewMenuOpen((open) => !open)}
        onClose={() => setViewMenuOpen(false)}
        onSelect={selectPlanView}
        onAddPlace={openMapToAdd}
      />
    </View>
  )
}

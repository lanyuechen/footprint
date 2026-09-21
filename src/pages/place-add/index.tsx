import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  DEFAULT_CENTER,
  MARKER_ID_SEARCH,
  SEARCH_DEBOUNCE_MS,
  coverRatioFromSheetHeight,
  estimateMapLatSpan,
  fitMapToPoints,
  nearlySameCoord,
  sheetHeightPx,
  useSheetMapCamera,
} from '../../components/sheet-map'
import type { PlaceInfo, CollectedPlace, TravelPlan } from '../../types'
import {
  distanceMeters,
  getUserLocation,
  lookupMapPlace,
  searchPlaces,
} from '../../services/amap'
import type { UserLocation } from '../../services/amap'
import {
  addStopsToDay,
  createPlace,
  deletePlace,
  getPlan,
  listPlacesByPlan,
  setLastPlanView,
} from '../../services/storage'
import { mapUiToSheetPos } from '../plan-view/map-geometry'
import { isSamePlace } from '../plan-view/place-info'
import { markerIconPath } from '../plan-view/place-axis'
import { MapStage } from '../plan-view/MapStage'
import type { MapUiMode, PreviewKind, SheetPos } from '../plan-view/types'
import '../plan-view/index.scss'
import './index.scss'

const PLACE_ADD_MAP_ID = 'place-add-map'

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

export default function PlaceAddPage() {
  const [planId, setPlanId] = useState('')
  /** 时间轴传入的 dayIndex（从 0 起） */
  const [tripDayIndex, setTripDayIndex] = useState<number | null>(null)
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [mapUi, setMapUi] = useState<MapUiMode>('browsing')
  const [previewKind, setPreviewKind] = useState<PreviewKind>('search')

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)

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
  /** 行程多选：已收藏地点 id */
  const [pickedIds, setPickedIds] = useState<string[]>([])
  /** 行程单选：搜索结果或地图选点（至多一个，未收藏时暂存） */
  const [pendingPlace, setPendingPlace] = useState<PlaceInfo | null>(null)

  const [inputFocus, setInputFocus] = useState(false)
  /** 取消搜索时先收起高度，动画结束后再切回浏览态 */
  const [leavingSearch, setLeavingSearch] = useState(false)
  const [scrollIntoView, setScrollIntoView] = useState('')
  /** 拖拽中的实时高度（px），null 表示跟档位 class */
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null)
  /** 已从存储删除、但仍在列表中展示的点，等底栏收起后再同步列表 */
  const [deferredUncollectIds, setDeferredUncollectIds] = useState<Set<string>>(
    () => new Set(),
  )

  const sheetPos = mapUiToSheetPos(mapUi, leavingSearch)
  const sheetHeightNow =
    dragHeightPx != null ? dragHeightPx : sheetHeightPx(sheetPos)
  const camera = useSheetMapCamera({
    mapId: PLACE_ADD_MAP_ID,
    sheetHeightPx: sheetHeightNow,
    sheetDragging: dragHeightPx != null,
  })

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
  /** 本次手势是否已离开点按范围，用来区分拖拽和聚焦 */
  const dragMovedRef = useRef(false)
  const focusScrollPendingRef = useRef(false)
  const ignoreFocusScrollUntilRef = useRef(0)
  /** 拖拽松手后紧跟的 click 不再当成点搜索框 */
  const suppressNextSearchClickRef = useRef(false)
  /** 主动聚焦后短时间内的 blur 不撤销焦点 */
  const ignoreBlurUntilRef = useRef(0)
  /** 搜索用当前地图关注点，不放进 effect 依赖，避免平移打断防抖 */
  const focusCoordRef = useRef(DEFAULT_CENTER)
  focusCoordRef.current = camera.focusCoord

  const refresh = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      setPlaces([])
      setDeferredUncollectIds(new Set())
      return
    }
    setPlan(p)
    setPlaces(listPlacesByPlan(id))
    Taro.setNavigationBarTitle({ title: '添加行程' })
  }

  const refreshPlanMeta = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      return
    }
    setPlan(p)
  }

  useLoad((options) => {
    const id = options?.id || ''
    const dayRaw = typeof options?.day === 'string' ? options.day : ''
    const dayIndex = Number.parseInt(dayRaw, 10)
    setPlanId(id)
    if (!id || !Number.isFinite(dayIndex) || dayIndex < 0) {
      Taro.showToast({ title: '参数缺失', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 500)
      return
    }
    setTripDayIndex(dayIndex)
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
    if (places.length > 0) {
      const fitted = fitMapToPoints(
        places.map((p) => ({
          latitude: p.place.latitude,
          longitude: p.place.longitude,
        })),
        browseCover,
      )
      camera.applyFocusViewport(fitted.center, fitted.scale)
    } else if (userLocation) {
      camera.applyFocusViewport(userLocation, 13)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, userLocation])

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

  const collectPlace = (place: PlaceInfo) => {
    if (!planId) return
    const existing = places.find(
      (p) => isSamePlace(p.place, place) && !deferredUncollectIds.has(p.id),
    )
    if (existing) {
      markDeferredUncollect(existing)
      return
    }
    const deferredSame = places.find(
      (p) => isSamePlace(p.place, place) && deferredUncollectIds.has(p.id),
    )
    if (deferredSame) {
      recollectDeferredPoint(deferredSame)
      return
    }
    try {
      const created = createPlace({ planId, place })
      const wasPending =
        !!pendingPlace && isSamePlace(pendingPlace, place)
      setPlaces((prev) => [created, ...prev])
      if (wasPending) setPendingPlace(null)
      if (wasPending) {
        setPickedIds((prev) =>
          prev.includes(created.id) ? prev : [...prev, created.id],
        )
      }
      refreshPlanMeta(planId)
      Taro.showToast({ title: '已收藏', icon: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  const findActiveCollected = (place: PlaceInfo) =>
    places.find(
      (p) => isSamePlace(p.place, place) && !deferredUncollectIds.has(p.id),
    )

  const isPlacePicked = (place: PlaceInfo) => {
    if (pendingPlace && isSamePlace(pendingPlace, place)) return true
    const collected = findActiveCollected(place)
    if (collected) return pickedIds.includes(collected.id)
    return false
  }

  /** 已收藏地点多选 */
  const toggleTripPick = (place: PlaceInfo) => {
    const collected = findActiveCollected(place)
    if (!collected) return
    const inIds = pickedIds.includes(collected.id)
    const pendingMatch = !!pendingPlace && isSamePlace(pendingPlace, place)
    if (inIds || pendingMatch) {
      setPickedIds((prev) => prev.filter((id) => id !== collected.id))
      if (pendingMatch) setPendingPlace(null)
      return
    }
    setPickedIds((prev) => [...prev, collected.id])
  }

  /** 搜索 / 地图：单选（替换上一次，不写入已收藏多选） */
  const selectSoloTripPlace = (place: PlaceInfo) => {
    setPendingPlace(place)
  }

  const tripPickCount = (() => {
    const ids = new Set(pickedIds)
    if (pendingPlace) {
      const collected = findActiveCollected(pendingPlace)
      if (collected) ids.add(collected.id)
      else return ids.size + 1
    }
    return ids.size
  })()

  const confirmTripAdd = () => {
    if (!planId || tripDayIndex == null) return
    if (tripPickCount === 0) {
      Taro.showToast({ title: '请选择地点', icon: 'none' })
      return
    }
    try {
      const placeIds = [...pickedIds]
      if (pendingPlace) {
        const existing = findActiveCollected(pendingPlace)
        if (existing) {
          if (!placeIds.includes(existing.id)) placeIds.push(existing.id)
        } else {
          const created = createPlace({ planId, place: pendingPlace })
          placeIds.push(created.id)
        }
      }
      const created = addStopsToDay({
        planId,
        dayIndex: tripDayIndex,
        placeIds,
      })
      setLastPlanView('timeline')
      Taro.showToast({
        title: created.length > 0 ? `已添加 ${created.length} 个` : '未添加',
        icon: created.length > 0 ? 'success' : 'none',
      })
      setTimeout(() => {
        Taro.navigateBack()
      }, 400)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }

  const cancelTripAdd = () => {
    Taro.navigateBack()
  }

  /** 选点前先读取当前地图真实跨度，再设置锚点 */
  const focusCoordOnMap = (
    coord: { latitude: number; longitude: number },
    after?: () => void,
  ) => {
    const apply = (span: number) => {
      camera.gesturingRef.current = false
      camera.rememberLatSpan(span)
      camera.setFocusCoord(coord)
      setMapUi('preview')
      after?.()
    }

    const fallback = () => {
      apply(
        estimateMapLatSpan(camera.mapScale, coord.latitude),
      )
    }

    try {
      const ctx = Taro.createMapContext(PLACE_ADD_MAP_ID)
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
    const list = places.map((p, i) => {
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
      const alreadyIn = places.some((p) =>
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
  }, [places, selectedPlace, pinnedSearchPlace, mapUi, previewKind])

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

  /** 点击搜索框：先到顶部，再聚焦 */
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
        selectSoloTripPlace(next)
        if (
          !nearlySameCoord(
            { latitude: next.latitude, longitude: next.longitude },
            { latitude, longitude },
          )
        ) {
          camera.setFocusCoord({
            latitude: next.latitude,
            longitude: next.longitude,
          })
        }
      })
      .catch(() => {
        // 详情补齐失败时保留点选时的名称和坐标
      })
  }

  const onSelectPlace = (item: PlaceInfo, source: 'map' | 'list' = 'list') => {
    clearInputFocus()
    moveSheet('middle')
    const next = source === 'map' ? placeFromMap(item) : item
    setPinnedSearchPlace(next)
    setSelectedPlace(next)
    setPreviewKind('search')
    setMapPickedPlace(source === 'map' ? next : null)
    selectSoloTripPlace(next)
    // 与已收藏一致：先读真实 latSpan 再设锚点，避免 applyFocusViewport 估算跨度导致偏上/反复偏移
    focusCoordOnMap(
      { latitude: next.latitude, longitude: next.longitude },
      source === 'map' ? () => revealSelectedPlace(next) : undefined,
    )
  }

  const focusPinnedSearchPlace = () => {
    if (!pinnedSearchPlace) return
    const next = placeFromMap(pinnedSearchPlace)
    setMapPickedPlace(next)
    setSelectedPlace(next)
    setPreviewKind('search')
    selectSoloTripPlace(next)
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

  const markDeferredUncollect = (point: CollectedPlace) => {
    deletePlace(point.id)
    setDeferredUncollectIds((prev) => new Set(prev).add(point.id))
    setPickedIds((prev) => prev.filter((id) => id !== point.id))
    if (planId) {
      refreshPlanMeta(planId)
    }
    Taro.showToast({ title: '已取消收藏', icon: 'success' })
  }

  const recollectDeferredPoint = (point: CollectedPlace) => {
    if (!planId) return
    try {
      const created = createPlace({
        planId,
        place: point.place,
      })
      setDeferredUncollectIds((prev) => {
        const next = new Set(prev)
        next.delete(point.id)
        return next
      })
      setPlaces((prev) => {
        const without = prev.filter((p) => p.id !== point.id)
        return [created, ...without]
      })
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

  const onToggleCollectedListStar = (point: CollectedPlace) => {
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
    const collected = places.find((point) => isSamePlace(point.place, place))
    if (collected) {
      scrollToCollectedPoint(collected.id)
      return
    }
    scrollSheetToTop()
  }

  const focusPointOnMap = (
    point: CollectedPlace,
    source: 'map' | 'list' = 'list',
  ) => {
    clearInputFocus()
    moveSheet('middle')
    setSelectedPlace(point.place)
    setPreviewKind('collected')
    // 不清理 pinnedSearchPlace：地图搜索点保留，搜索结果只取消高亮
    if (source === 'map') {
      setMapPickedPlace(placeFromMap(point.place))
      selectSoloTripPlace(point.place)
    } else {
      setMapPickedPlace(null)
    }
    focusCoordOnMap(
      {
        latitude: point.place.latitude,
        longitude: point.place.longitude,
      },
      // 地图选点：列表滚到该条；列表点选：不滚顶
      source === 'map' ? () => revealSelectedPlace(point.place) : undefined,
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

    const point = places[markerId - 1]
    if (point) {
      focusPointOnMap(point, 'map')
    }
  }

  const onRegionChangeRef = useRef(camera.onRegionChange)
  onRegionChangeRef.current = camera.onRegionChange
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
      onRegionChangeRef.current(e)
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
    <View className='detail detail--map'>
      <MapStage
        mapId={PLACE_ADD_MAP_ID}
        gesturingRef={camera.gesturingRef}
        mapCenter={camera.mapCenter}
        mapScale={camera.mapScale}
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
        points={places}
        inSearchUi={inSearchUi}
        deferredUncollectIds={deferredUncollectIds}
        selectedPlace={selectedPlace}
        mapPickedPlace={mapPickedPlace}
        focusPointOnMap={focusPointOnMap}
        onToggleCollectedListStar={onToggleCollectedListStar}
        isPlacePicked={isPlacePicked}
        onToggleTripPick={toggleTripPick}
      />
      {sheetPos !== 'bottom' ? (
        <View className='trip-confirm-bar'>
          <View className='trip-confirm-bar__btn' onClick={cancelTripAdd}>
            取消
          </View>
          <View
            className='trip-confirm-bar__btn trip-confirm-bar__btn--primary'
            onClick={confirmTripAdd}
          >
            确定{tripPickCount > 0 ? `（${tripPickCount}）` : ''}
          </View>
        </View>
      ) : null}
    </View>
  )
}

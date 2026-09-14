import { useLoad } from '@tarojs/taro'
import { View, Text, Map, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavMode, NavRoute, NavRoutePoint, NavStepKind, PlaceInfo } from '../../types'
import {
  NAV_MODES,
  NAV_STEP_COLORS,
  getLastNavMode,
  getUserLocation,
  planRoutes,
  setLastNavMode,
  type UserLocation,
} from '../../services/amap'
import { getPoint } from '../../services/storage'
import { formatDistance, formatDuration } from '../../utils/datetime'
import './index.scss'

const NAV_MAP_ID = 'nav-route-map'
const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }
/** 与计划详情底栏 height transition 对齐 */
const MAP_CENTER_EASE_MS = 320

/** 与计划详情底栏同档：底 / 中 / 顶 */
type PanelPos = 'bottom' | 'middle' | 'top'

const PANEL_BOTTOM_RPX = 300
const PANEL_MIDDLE_VH = 0.52

const STEP_KIND_LABEL: Record<NavStepKind, string> = {
  walk: '步行',
  ride: '骑行',
  bus: '公交',
  metro: '地铁',
  railway: '火车',
  other: '行程',
}

function isUserMapGesture(causedBy?: string) {
  return (
    causedBy === 'gesture' ||
    causedBy === 'drag' ||
    causedBy === 'scale'
  )
}

function getWindowMetrics() {
  const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
  return {
    windowHeight: info.windowHeight || 667,
    windowWidth: info.windowWidth || 375,
  }
}

function panelHeightPx(pos: PanelPos): number {
  const { windowHeight, windowWidth } = getWindowMetrics()
  if (pos === 'top') return windowHeight
  if (pos === 'middle') return windowHeight * PANEL_MIDDLE_VH
  return (PANEL_BOTTOM_RPX / 750) * windowWidth
}

function coverRatioFromPanelHeight(heightPx: number): number {
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

/** 把可视锚点对齐到「未被底栏遮挡」区域的几何中心 → 地图组件中心 */
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

/** 由地图组件中心反推可视锚点 */
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
 * 与计划详情 fitMapToPoints 一致：
 * 包围盒外扩 1/3，缩放按底栏遮挡后的可视高度计算。
 * 返回的 center 是「可视锚点」（路线几何中心），不是 Map 的 latitude。
 */
function fitMapToPoints(
  coords: NavRoutePoint[],
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

  const latSpan = Math.max(maxLat - minLat, 1e-5) * (4 / 3)
  const lngSpan = Math.max(maxLng - minLng, 1e-5) * (4 / 3)

  const { windowHeight, windowWidth } = getWindowMetrics()
  const cosLat = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.2)
  const visibleHeightRatio = Math.max(
    1 - Math.min(Math.max(coverRatio, 0), 0.7),
    0.35,
  )
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
  scale = Math.min(17, Math.max(4, Math.floor(scale)))

  return { center, scale }
}

function stepMetaText(step: {
  distanceMeters?: number
  durationSeconds?: number
}): string {
  const parts: string[] = []
  if (step.distanceMeters != null && step.distanceMeters > 0) {
    parts.push(formatDistance(step.distanceMeters))
  }
  if (step.durationSeconds != null && step.durationSeconds > 0) {
    parts.push(formatDuration(step.durationSeconds))
  }
  return parts.join(' · ')
}

export default function NavPage() {
  const [destination, setDestination] = useState<PlaceInfo | null>(null)
  const [origin, setOrigin] = useState<UserLocation | null>(null)
  const [mode, setMode] = useState<NavMode>(() => getLastNavMode())
  const [routes, setRoutes] = useState<NavRoute[]>([])
  const [schemeIndex, setSchemeIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /** 可视锚点（路线/分段几何中心），落在底栏上方可视区 */
  const [focusCoord, setFocusCoord] = useState(DEFAULT_CENTER)
  const [mapScale, setMapScale] = useState(12)
  const [mapViewLatSpan, setMapViewLatSpan] = useState(0)

  /** 面板档位：切换出行方式 / 刷新路线时保持不变 */
  const [panelPos, setPanelPos] = useState<PanelPos>('middle')
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null)

  const seqRef = useRef(0)
  const fittingRef = useRef(false)
  const userGesturingRef = useRef(false)
  const mapScaleRef = useRef(12)
  const panelPosRef = useRef<PanelPos>('middle')
  const sheetCoverRatioRef = useRef(0.5)
  const mapViewLatSpanRef = useRef(0)
  const mapCenterDisplayRef = useRef(DEFAULT_CENTER)
  const mapCenterAnimRaf = useRef<number | null>(null)
  const suppressCenterFollowRef = useRef(false)
  const dragRef = useRef<{
    active: boolean
    startY: number
    startH: number
    from: PanelPos
  } | null>(null)

  const route = routes[schemeIndex] || null
  mapScaleRef.current = mapScale
  panelPosRef.current = panelPos
  mapViewLatSpanRef.current = mapViewLatSpan

  const panelHeightNow =
    dragHeightPx != null ? dragHeightPx : panelHeightPx(panelPos)
  const panelCoverRatio = coverRatioFromPanelHeight(panelHeightNow)
  sheetCoverRatioRef.current = panelCoverRatio

  const effectiveLatSpan =
    mapViewLatSpan > 0
      ? mapViewLatSpan
      : estimateMapLatSpan(mapScale, focusCoord.latitude)

  const targetMapCenter = useMemo(
    () => offsetCenterForSheet(focusCoord, panelCoverRatio, effectiveLatSpan),
    [focusCoord, panelCoverRatio, effectiveLatSpan],
  )

  const [mapCenter, setMapCenter] = useState(targetMapCenter)

  const cancelMapCenterAnim = () => {
    if (mapCenterAnimRaf.current != null) {
      cancelAnimationFrame(mapCenterAnimRaf.current)
      mapCenterAnimRaf.current = null
    }
  }

  const applyMapCenter = (next: { latitude: number; longitude: number }) => {
    if (userGesturingRef.current) return
    mapCenterDisplayRef.current = next
    setMapCenter(next)
  }

  // 面板高度变化 / 锚点变化时，跟手或缓动更新地图中心（与计划详情一致）
  useEffect(() => {
    if (userGesturingRef.current) return

    const to = targetMapCenter
    const from = mapCenterDisplayRef.current

    if (suppressCenterFollowRef.current) {
      suppressCenterFollowRef.current = false
      mapCenterDisplayRef.current = to
      return
    }

    cancelMapCenterAnim()

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
    fittingRef.current = true

    const tick = () => {
      if (userGesturingRef.current) {
        mapCenterAnimRaf.current = null
        fittingRef.current = false
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
        fittingRef.current = false
      }
    }

    mapCenterAnimRaf.current = requestAnimationFrame(tick)
    return () => {
      cancelMapCenterAnim()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMapCenter, dragHeightPx])

  /** 设置可视锚点 + 缩放；Map 中心由 offset + follow effect 处理 */
  const applyViewport = (points: NavRoutePoint[]) => {
    if (points.length === 0) return
    const cover = coverRatioFromPanelHeight(
      dragHeightPx != null
        ? dragHeightPx
        : panelHeightPx(panelPosRef.current),
    )
    const fitted = fitMapToPoints(points, cover)
    const span = estimateMapLatSpan(fitted.scale, fitted.center.latitude)
    const mapC = offsetCenterForSheet(fitted.center, cover, span)

    fittingRef.current = true
    suppressCenterFollowRef.current = true
    setFocusCoord(fitted.center)
    mapViewLatSpanRef.current = span
    setMapViewLatSpan(span)
    mapCenterDisplayRef.current = mapC
    setMapCenter(mapC)

    if (fitted.scale === mapScaleRef.current) {
      setMapScale(Math.min(20, fitted.scale + 1))
      setTimeout(() => {
        setMapScale(fitted.scale)
        setTimeout(() => {
          fittingRef.current = false
        }, 80)
      }, 40)
    } else {
      setMapScale(fitted.scale)
      setTimeout(() => {
        fittingRef.current = false
      }, 280)
    }
  }

  const applyRouteView = (r: NavRoute, seq: number) => {
    setStepIndex(null)
    setTimeout(() => {
      if (seq !== seqRef.current) return
      applyViewport(r.points)
    }, 60)
  }

  const applyStepView = (points: NavRoutePoint[]) => {
    applyViewport(points)
  }

  useLoad((options) => {
    const pointId = options?.pointId || ''
    if (!pointId) {
      Taro.showToast({ title: '缺少目的地', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    const point = getPoint(pointId)
    if (!point) {
      Taro.showToast({ title: '地点不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    setDestination(point.place)
    Taro.setNavigationBarTitle({ title: point.place.name || '路线导航' })
  })

  useEffect(() => {
    let cancelled = false
    getUserLocation().then((loc) => {
      if (cancelled) return
      if (!loc) {
        setError('无法获取当前位置，请开启定位权限后重试')
        setLoading(false)
        return
      }
      setOrigin(loc)
      setFocusCoord(loc)
      const cover = coverRatioFromPanelHeight(panelHeightPx(panelPosRef.current))
      const span = estimateMapLatSpan(mapScaleRef.current, loc.latitude)
      const mapC = offsetCenterForSheet(loc, cover, span)
      mapCenterDisplayRef.current = mapC
      setMapCenter(mapC)
      mapViewLatSpanRef.current = span
      setMapViewLatSpan(span)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!origin || !destination) return

    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    setRoutes([])
    setSchemeIndex(0)
    setStepIndex(null)

    planRoutes(mode, origin, {
      latitude: destination.latitude,
      longitude: destination.longitude,
    })
      .then((list) => {
        if (seq !== seqRef.current) return
        setRoutes(list)
        setSchemeIndex(0)
        setLoading(false)
        if (list[0]) applyRouteView(list[0], seq)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        const msg = err instanceof Error ? err.message : '路线规划失败'
        setError(msg)
        setLoading(false)
      })
  }, [origin, destination, mode])

  const onSelectMode = (next: NavMode) => {
    if (next === mode) return
    setMode(next)
    setLastNavMode(next)
  }

  const onSelectScheme = (index: number) => {
    if (index === schemeIndex) return
    const next = routes[index]
    if (!next) return
    setSchemeIndex(index)
    applyRouteView(next, seqRef.current)
  }

  const onSelectStep = (index: number) => {
    const step = route?.steps[index]
    if (!step) return
    if (stepIndex === index) {
      setStepIndex(null)
      if (route) applyRouteView(route, seqRef.current)
      return
    }
    setStepIndex(index)
    if (step.points && step.points.length >= 2) {
      applyStepView(step.points)
    } else {
      Taro.showToast({ title: '该分段暂无路径坐标', icon: 'none' })
    }
  }

  const resolveHeightSnap = (heightPx: number): PanelPos => {
    const minH = panelHeightPx('bottom')
    const maxH = panelHeightPx('top')
    const t = (heightPx - minH) / Math.max(maxH - minH, 1)
    if (t < 0.25) return 'bottom'
    if (t < 0.75) return 'middle'
    return 'top'
  }

  const onPanelDragStart = (clientY: number) => {
    dragRef.current = {
      active: true,
      startY: clientY,
      startH: panelHeightPx(panelPos),
      from: panelPos,
    }
    setDragHeightPx(panelHeightPx(panelPos))
  }

  const onPanelDragMove = (clientY: number) => {
    const drag = dragRef.current
    if (!drag?.active) return
    const dy = clientY - drag.startY
    const minH = panelHeightPx('bottom')
    const maxH = panelHeightPx('top')
    const next = Math.min(maxH, Math.max(minH, drag.startH - dy))
    setDragHeightPx(next)
  }

  const onPanelDragEnd = (clientY: number) => {
    const drag = dragRef.current
    if (!drag?.active) return
    dragRef.current = null
    const minH = panelHeightPx('bottom')
    const maxH = panelHeightPx('top')
    const endH = Math.min(
      maxH,
      Math.max(minH, drag.startH - (clientY - drag.startY)),
    )
    const target = resolveHeightSnap(endH)
    setDragHeightPx(null)
    if (target !== drag.from) {
      setPanelPos(target)
    }
  }

  const onPanelTouchStart = (e: { touches: Array<{ clientY: number }> }) => {
    const y = e.touches[0]?.clientY
    if (y == null) return
    onPanelDragStart(y)
  }

  const onPanelTouchMove = (e: { touches: Array<{ clientY: number }> }) => {
    const y = e.touches[0]?.clientY
    if (y == null) return
    onPanelDragMove(y)
  }

  const onPanelTouchEnd = (e: {
    changedTouches?: Array<{ clientY: number }>
    touches?: Array<{ clientY: number }>
  }) => {
    const y = e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY
    if (y == null) {
      dragRef.current = null
      setDragHeightPx(null)
      return
    }
    onPanelDragEnd(y)
  }

  const onRegionChange = (e: {
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
        userGesturingRef.current = true
        cancelMapCenterAnim()
      }
      return
    }

    if (type !== 'end') return
    if (fittingRef.current) return

    const spanFromEvent = readLatSpanFromRegion(detail.region)
    if (spanFromEvent) {
      mapViewLatSpanRef.current = spanFromEvent
    }

    if (!userGesturingRef.current && !isUserMapGesture(causedBy)) return
    userGesturingRef.current = false

    const center =
      detail.centerLocation ||
      (detail.latitude != null && detail.longitude != null
        ? { latitude: detail.latitude, longitude: detail.longitude }
        : null)
    if (!center) {
      if (causedBy === 'scale' && detail.scale != null) {
        setMapScale(Math.round(detail.scale))
      }
      if (spanFromEvent) setMapViewLatSpan(spanFromEvent)
      return
    }

    const latSpan =
      spanFromEvent ||
      mapViewLatSpanRef.current ||
      estimateMapLatSpan(
        detail.scale ?? mapScaleRef.current,
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

    // 仅缩放手势结束回写 scale
    if (causedBy === 'scale' && detail.scale != null && Number.isFinite(detail.scale)) {
      setMapScale(Math.round(detail.scale))
    }
  }

  const markers = useMemo(() => {
    if (!destination) return []
    return [
      {
        id: 2,
        latitude: destination.latitude,
        longitude: destination.longitude,
        title: '终点',
        callout: {
          content: destination.name,
          display: 'ALWAYS' as const,
          padding: 6,
          borderRadius: 6,
          fontSize: 12,
        },
      },
    ]
  }, [destination])

  const polyline = useMemo(() => {
    if (!route) return []
    const segmentLines = route.steps
      .map((step, index) => {
        if (!step.points || step.points.length < 2) return null
        return {
          points: step.points,
          color: step.color || NAV_STEP_COLORS[index % NAV_STEP_COLORS.length],
          width: 6,
          dottedLine: false,
          arrowLine: false,
        }
      })
      .filter((item): item is NonNullable<typeof item> => !!item)

    if (segmentLines.length > 0) return segmentLines

    if (route.points.length < 2) return []
    return [
      {
        points: route.points,
        color: '#1a5f4a',
        width: 6,
        dottedLine: false,
        arrowLine: false,
      },
    ]
  }, [route])

  const showPanelBody = panelPos !== 'bottom' || dragHeightPx != null

  const panelClass = [
    'nav__panel',
    `nav__panel--${panelPos}`,
    dragHeightPx != null ? 'nav__panel--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const peekText = (() => {
    if (!origin && !error) return '正在获取当前位置…'
    if (loading) return '正在规划路线…'
    if (error) return error
    if (route) {
      return `${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`
    }
    return destination?.name || ''
  })()

  return (
    <View className='nav'>
      <Map
        id={NAV_MAP_ID}
        className='nav__map'
        latitude={mapCenter.latitude}
        longitude={mapCenter.longitude}
        scale={mapScale}
        markers={markers as never}
        polyline={polyline as never}
        showLocation
        onRegionChange={onRegionChange as never}
      />

      <View
        className={panelClass}
        style={
          dragHeightPx != null ? { height: `${dragHeightPx}px` } : undefined
        }
      >
        <View
          className='nav__grab'
          catchMove
          onTouchStart={onPanelTouchStart}
          onTouchMove={onPanelTouchMove}
          onTouchEnd={onPanelTouchEnd}
          onTouchCancel={onPanelTouchEnd}
        >
          <View className='nav__handle'>
            <View className='nav__handle-bar' />
          </View>

          <View className='nav__modes'>
            {NAV_MODES.map((item) => (
              <View
                key={item.id}
                className={`nav__mode${mode === item.id ? ' nav__mode--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectMode(item.id)
                }}
              >
                {item.label}
              </View>
            ))}
          </View>

          {!showPanelBody && (
            <View className='nav__peek'>
              <Text className='nav__peek-text'>{peekText}</Text>
            </View>
          )}
        </View>

        {showPanelBody && (
          <ScrollView scrollY className='nav__body' enhanced showScrollbar>
            <View className='nav__dest'>
              <Text className='nav__dest-label'>终点</Text>
              <Text className='nav__dest-name'>
                {destination?.name || '加载中…'}
              </Text>
              {!!destination?.address && (
                <Text className='nav__dest-addr'>{destination.address}</Text>
              )}
            </View>

            {!origin && !error ? (
              <View className='nav__status'>正在获取当前位置…</View>
            ) : loading ? (
              <View className='nav__status'>正在规划路线…</View>
            ) : error ? (
              <View className='nav__status nav__status--error'>{error}</View>
            ) : route ? (
              <View className='nav__result'>
                {routes.length > 1 && (
                  <ScrollView scrollX className='nav__schemes' enhanced>
                    <View className='nav__schemes-row'>
                      {routes.map((item, index) => (
                        <View
                          key={`scheme-${index}`}
                          className={`nav__scheme${
                            index === schemeIndex ? ' nav__scheme--active' : ''
                          }`}
                          onClick={() => onSelectScheme(index)}
                        >
                          <Text className='nav__scheme-label'>
                            方案{index + 1}
                          </Text>
                          <Text className='nav__scheme-main'>
                            {formatDuration(item.durationSeconds)}
                          </Text>
                          <Text className='nav__scheme-sub'>
                            {formatDistance(item.distanceMeters)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}

                <View className='nav__summary'>
                  <Text className='nav__summary-main'>
                    {formatDistance(route.distanceMeters)} ·{' '}
                    {formatDuration(route.durationSeconds)}
                  </Text>
                  {!!route.summary && (
                    <Text className='nav__summary-sub'>{route.summary}</Text>
                  )}
                </View>

                {route.steps.length > 0 && (
                  <View className='nav__steps'>
                    {route.steps.map((step, index) => {
                      const meta = stepMetaText(step)
                      const last = index === route.steps.length - 1
                      const color =
                        step.color ||
                        NAV_STEP_COLORS[index % NAV_STEP_COLORS.length]
                      const active = stepIndex === index
                      return (
                        <View
                          key={`${schemeIndex}-${index}-${step.title}`}
                          className={`nav-step${
                            last ? ' nav-step--last' : ''
                          }${active ? ' nav-step--active' : ''}`}
                          onClick={() => onSelectStep(index)}
                        >
                          <View className='nav-step__rail'>
                            <View
                              className='nav-step__dot'
                              style={{ backgroundColor: color }}
                            />
                            {!last && <View className='nav-step__line' />}
                          </View>
                          <View className='nav-step__body'>
                            <View className='nav-step__tag' style={{ color }}>
                              {STEP_KIND_LABEL[step.kind]}
                            </View>
                            <Text className='nav-step__title'>{step.title}</Text>
                            {!!step.detail && (
                              <Text className='nav-step__detail'>
                                {step.detail}
                              </Text>
                            )}
                            {!!meta && (
                              <Text className='nav-step__meta'>{meta}</Text>
                            )}
                          </View>
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  )
}

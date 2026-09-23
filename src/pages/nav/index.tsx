import { useLoad } from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SheetMapFrame,
  sheetHeightPx,
  useSheetDrag,
  useSheetMapCamera,
  type SheetPos,
} from '../../components/sheet-map'
import type {
  NavMode,
  NavRoute,
  NavRoutePoint,
  NavStepKind,
  PlaceInfo,
} from '../../types'
import {
  NAV_MODES,
  NAV_STEP_COLORS,
  getLastNavMode,
  getUserLocation,
  planRoutes,
  setLastNavMode,
  type UserLocation,
} from '../../services/amap'
import { getPlace } from '../../services/storage'
import { formatDistance, formatDuration } from '../../utils/datetime'
import {
  ensureLabeledDotMarker,
  getLabeledDotMarkerPath,
  NUMBERED_DOT_DISPLAY_SIZE,
  NUMBERED_DOT_FALLBACK,
} from '../../features/trip/numbered-dot-markers'
import './index.scss'

const NAV_MAP_ID = 'nav-route-map'
const PANEL_BOTTOM_RPX = 300
const NAV_MARKER_START = '起'
const NAV_MARKER_END = '终'
const NAV_START_STYLE = { fill: '#1a5f4a', stroke: '#ffffff' }
const NAV_END_STYLE = { fill: '#c45c5c', stroke: '#ffffff' }

const STEP_KIND_LABEL: Record<NavStepKind, string> = {
  walk: '步行',
  ride: '骑行',
  bus: '公交',
  metro: '地铁',
  railway: '火车',
  other: '行程',
}

function navPanelHeightPx(pos: SheetPos): number {
  return sheetHeightPx(pos, { bottomRpx: PANEL_BOTTOM_RPX })
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
  const [originName, setOriginName] = useState('起点')
  const [originFixed, setOriginFixed] = useState(false)
  const [mode, setMode] = useState<NavMode>(() => getLastNavMode())
  const [routes, setRoutes] = useState<NavRoute[]>([])
  const [schemeIndex, setSchemeIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [panelPos, setPanelPos] = useState<SheetPos>('middle')
  const [endpointIconTick, setEndpointIconTick] = useState(0)

  const seqRef = useRef(0)
  const originFixedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      ensureLabeledDotMarker(NAV_MARKER_START, NAV_START_STYLE),
      ensureLabeledDotMarker(NAV_MARKER_END, NAV_END_STYLE),
    ])
      .then(() => {
        if (!cancelled) setEndpointIconTick((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const sheet = useSheetDrag({
    heightForPos: navPanelHeightPx,
    pos: panelPos,
    setPos: setPanelPos,
  })

  const camera = useSheetMapCamera({
    mapId: NAV_MAP_ID,
    sheetHeightPx: sheet.sheetHeightNow,
    sheetDragging: sheet.sheetDragging,
  })

  const route = routes[schemeIndex] || null

  const endpointPoints = useMemo(() => {
    const pts: Array<{ latitude: number; longitude: number }> = []
    if (origin) {
      pts.push({ latitude: origin.latitude, longitude: origin.longitude })
    }
    if (destination) {
      pts.push({
        latitude: destination.latitude,
        longitude: destination.longitude,
      })
    }
    return pts
  }, [origin, destination])

  const applyViewport = (
    points: Array<{ latitude: number; longitude: number }>,
    opts?: { animate?: boolean },
  ) => {
    if (points.length === 0) return
    const animate = opts?.animate === true
    camera.beginOwnMapMove()
    camera.fitToPoints(points, { animate })
    setTimeout(() => {
      camera.endOwnMapMove()
    }, animate ? 320 : 80)
  }

  const applyRouteView = (r: NavRoute, seq: number, animate = false) => {
    setStepIndex(null)
    const pts = [
      ...endpointPoints,
      ...(r.points || []).map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    ]
    // 等底栏高度计入地图可视高度后再 fit
    setTimeout(() => {
      if (seq !== seqRef.current) return
      applyViewport(pts.length > 0 ? pts : r.points, { animate })
    }, 80)
  }

  const applyStepView = (points: NavRoutePoint[]) => {
    applyViewport(points, { animate: true })
  }

  useLoad((options) => {
    const placeId = options?.placeId || options?.pointId || ''
    if (!placeId) {
      Taro.showToast({ title: '缺少目的地', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    const place = getPlace(placeId)
    if (!place) {
      Taro.showToast({ title: '地点不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    setDestination(place.place)
    Taro.setNavigationBarTitle({ title: place.place.name || '路线导航' })

    const modeParam = String(options?.mode || '')
    if (
      modeParam === 'walking' ||
      modeParam === 'riding' ||
      modeParam === 'transit'
    ) {
      setMode(modeParam)
      setLastNavMode(modeParam)
    }

    const fromLat = Number(options?.fromLat)
    const fromLng = Number(options?.fromLng)
    if (Number.isFinite(fromLat) && Number.isFinite(fromLng)) {
      const nameRaw = options?.fromName
      let name = '起点'
      if (typeof nameRaw === 'string' && nameRaw.trim()) {
        try {
          name = decodeURIComponent(nameRaw)
        } catch {
          name = nameRaw
        }
      }
      originFixedRef.current = true
      setOriginFixed(true)
      setOriginName(name)
      setOrigin({ latitude: fromLat, longitude: fromLng })
    }
  })

  useEffect(() => {
    if (originFixedRef.current || originFixed) return
    let cancelled = false
    getUserLocation().then((loc) => {
      if (cancelled || originFixedRef.current) return
      if (!loc) {
        setError('无法获取当前位置，请开启定位权限后重试')
        setLoading(false)
        return
      }
      setOrigin(loc)
      setOriginName('我的位置')
    })
    return () => {
      cancelled = true
    }
  }, [originFixed])

  /** 起终点就绪后先按两点适配（路线返回前的过渡视野） */
  useEffect(() => {
    if (endpointPoints.length < 1) return
    applyViewport(endpointPoints, { animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointPoints])

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
        if (list[0]) applyRouteView(list[0], seq, false)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        const msg = err instanceof Error ? err.message : '路线规划失败'
        setError(msg)
        setLoading(false)
        applyViewport(endpointPoints, { animate: false })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    applyRouteView(next, seqRef.current, true)
  }

  const onSelectStep = (index: number) => {
    const step = route?.steps[index]
    if (!step) return
    if (stepIndex === index) {
      setStepIndex(null)
      if (route) applyRouteView(route, seqRef.current, true)
      return
    }
    setStepIndex(index)
    if (step.points && step.points.length >= 2) {
      applyStepView(step.points)
    } else {
      Taro.showToast({ title: '该分段暂无路径坐标', icon: 'none' })
    }
  }

  const markers = useMemo(() => {
    if (!destination) return []
    const startIcon =
      getLabeledDotMarkerPath(NAV_MARKER_START, NAV_START_STYLE) ||
      NUMBERED_DOT_FALLBACK
    const endIcon =
      getLabeledDotMarkerPath(NAV_MARKER_END, NAV_END_STYLE) ||
      NUMBERED_DOT_FALLBACK
    const size = NUMBERED_DOT_DISPLAY_SIZE
    const list: Array<Record<string, unknown>> = []
    if (origin) {
      list.push({
        id: 1,
        latitude: origin.latitude,
        longitude: origin.longitude,
        width: size,
        height: size,
        iconPath: startIcon,
        anchor: { x: 0.5, y: 0.5 },
        zIndex: 12,
        title: '起点',
        callout: {
          content: originName,
          display: 'ALWAYS' as const,
          padding: 6,
          borderRadius: 6,
          fontSize: 12,
        },
      })
    }
    list.push({
      id: 2,
      latitude: destination.latitude,
      longitude: destination.longitude,
      width: size,
      height: size,
      iconPath: endIcon,
      anchor: { x: 0.5, y: 0.5 },
      zIndex: 12,
      title: '终点',
      callout: {
        content: destination.name,
        display: 'ALWAYS' as const,
        padding: 6,
        borderRadius: 6,
        fontSize: 12,
      },
    })
    return list
    // endpointIconTick：图标异步生成后刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, origin, originName, endpointIconTick])

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
          arrowLine: true,
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
        arrowLine: true,
      },
    ]
  }, [route])

  const panelClass = [
    'nav__panel',
    `nav__panel--${panelPos}`,
    sheet.sheetDragging ? 'nav__panel--dragging' : '',
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
    <SheetMapFrame
      mapId={NAV_MAP_ID}
      camera={camera}
      sheet={sheet}
      sheetPos={panelPos}
      markers={markers as Array<Record<string, unknown>>}
      polyline={polyline as Array<Record<string, unknown>>}
      className='nav'
      mapClassName='nav__map'
      sheetClassName={panelClass}
      grabClassName='nav__grab'
      header={
        <>
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

          {!sheet.showSheetBody && (
            <View className='nav__peek'>
              <Text className='nav__peek-text'>{peekText}</Text>
            </View>
          )}
        </>
      }
      body={
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
      }
    />
  )
}

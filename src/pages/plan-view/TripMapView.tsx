import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import { formatClock } from '../../utils/datetime'
import {
  coverRatioFromSheetHeight,
  DEFAULT_CENTER,
  easeOutCubic,
  estimateMapLatSpan,
  fitMapToPoints,
  MAP_CENTER_EASE_MS,
  nearlySameCoord,
  offsetCenterForSheet,
  readLatSpanFromRegion,
  reverseOffsetCenterForSheet,
  sheetHeightPx,
} from './map-geometry'
import { markerIconPath, placeAxisMark, lightenColor } from './place-axis'
import { PlanMap, PLAN_MAP_ID, mapUserGesturingRef } from './PlanMap'
import { buildTimelineYears, type TimelineDay } from './timeline-model'
import type { SheetPos } from './types'

type TripStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

type TripMapViewProps = {
  plan: TravelPlan
  places: CollectedPlace[]
  stops: TripStop[]
}

const SHEET_TAP_SLOP_PX = 10
const TRIP_SHEET_BOTTOM_RPX = 240
const MARKER_CANVAS = { width: 1424, height: 1444 }
const MARKER_ANCHOR = { x: 0.5, y: (1018.56 + 200) / MARKER_CANVAS.height }

function tripSheetHeightPx(pos: SheetPos): number {
  if (pos === 'bottom') {
    const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
    return (TRIP_SHEET_BOTTOM_RPX / 750) * info.windowWidth
  }
  return sheetHeightPx(pos)
}

function placeMarkerIcon(
  place: CollectedPlace['place'],
  selected: boolean,
) {
  const width = selected ? 58 : 50
  return {
    iconPath: markerIconPath(place),
    width,
    height: Math.round((width * MARKER_CANVAS.height) / MARKER_CANVAS.width),
    anchor: MARKER_ANCHOR,
  }
}

/** 同一天内相同 placeId 只保留第一次出现 */
function uniqueStopsByPlace(dayStops: TripStopView[]): TripStopView[] {
  const seen = new Set<string>()
  const out: TripStopView[] = []
  for (const stop of dayStops) {
    if (seen.has(stop.placeId)) continue
    seen.add(stop.placeId)
    out.push(stop)
  }
  return out
}

export function TripMapView({ plan, places, stops }: TripMapViewProps) {
  const days = useMemo(() => {
    const years = buildTimelineYears(plan, stops, places)
    return years.flatMap((y) => y.days)
  }, [plan, stops, places])

  const [dayKey, setDayKey] = useState('')
  const [sheetPos, setSheetPos] = useState<SheetPos>('bottom')
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null)
  const [selectedStopId, setSelectedStopId] = useState('')
  /** 真实地理焦点（行程包围中心 / 选中点），不含底栏偏移 */
  const [focusCoord, setFocusCoord] = useState(DEFAULT_CENTER)
  const [mapScale, setMapScale] = useState(12)
  const [mapViewLatSpan, setMapViewLatSpan] = useState(0)

  const dragRef = useRef<{
    active: boolean
    startY: number
    startH: number
  } | null>(null)
  const dragMovedRef = useRef(false)
  const mapCenterDisplayRef = useRef(DEFAULT_CENTER)
  const mapCenterAnimRaf = useRef<number | null>(null)
  const mapViewLatSpanRef = useRef(0)
  const mapScaleRef = useRef(12)
  const sheetCoverRatioRef = useRef(0.12)
  const suppressCenterFollowRef = useRef(false)
  const sheetPosRef = useRef(sheetPos)
  sheetPosRef.current = sheetPos

  const sheetHeightNow =
    dragHeightPx != null ? dragHeightPx : tripSheetHeightPx(sheetPos)
  const sheetCoverRatio = coverRatioFromSheetHeight(sheetHeightNow)
  sheetCoverRatioRef.current = sheetCoverRatio
  mapScaleRef.current = mapScale
  mapViewLatSpanRef.current = mapViewLatSpan

  const effectiveLatSpan =
    mapViewLatSpan > 0
      ? mapViewLatSpan
      : estimateMapLatSpan(mapScale, focusCoord.latitude)

  const targetMapCenter = useMemo(
    () => offsetCenterForSheet(focusCoord, sheetCoverRatio, effectiveLatSpan),
    [focusCoord, sheetCoverRatio, effectiveLatSpan],
  )

  const [mapCenter, setMapCenter] = useState(targetMapCenter)

  const cancelMapCenterAnim = () => {
    if (mapCenterAnimRaf.current != null) {
      cancelAnimationFrame(mapCenterAnimRaf.current)
      mapCenterAnimRaf.current = null
    }
  }

  const applyMapCenter = (next: {
    latitude: number
    longitude: number
  }) => {
    if (mapUserGesturingRef.current) return
    mapCenterDisplayRef.current = next
    setMapCenter(next)
  }

  // panel 高度 / 锚点变化：拖栏跟手，松手或换日/选点时缓动
  useEffect(() => {
    if (mapUserGesturingRef.current) return

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
    const tick = () => {
      if (mapUserGesturingRef.current) {
        mapCenterAnimRaf.current = null
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

  useEffect(() => {
    return () => cancelMapCenterAnim()
  }, [])

  useEffect(() => {
    if (days.length === 0) {
      setDayKey('')
      return
    }
    if (!days.some((d) => d.datePart === dayKey)) {
      setDayKey(days[0].datePart)
    }
  }, [days, dayKey])

  const selectedDay: TimelineDay | null =
    days.find((d) => d.datePart === dayKey) || days[0] || null

  const dayStops = selectedDay?.stops || []
  const mapStops = useMemo(() => uniqueStopsByPlace(dayStops), [dayStops])
  const mapStopsKey = useMemo(
    () => mapStops.map((s) => s.id).join('|'),
    [mapStops],
  )

  /** 换日 / 选点：更新锚点 + 强制落到合适缩放（同值时 bump 一次，否则微信 Map 不重应用） */
  const applyFocusViewport = (
    focus: { latitude: number; longitude: number },
    scale: number,
  ) => {
    const nextScale = Math.min(20, Math.max(3, Math.round(scale)))
    const span = estimateMapLatSpan(nextScale, focus.latitude)
    mapViewLatSpanRef.current = span
    setMapViewLatSpan(span)
    setFocusCoord(focus)

    if (nextScale === mapScaleRef.current) {
      const bump = Math.min(20, nextScale + 1)
      mapScaleRef.current = bump
      setMapScale(bump)
      setTimeout(() => {
        mapScaleRef.current = nextScale
        setMapScale(nextScale)
      }, 40)
    } else {
      mapScaleRef.current = nextScale
      setMapScale(nextScale)
    }
  }

  // 仅换日（行程点集合变化）时改锚点 + 缩放；中心由 follow effect 处理
  useEffect(() => {
    setSelectedStopId('')
    const cover = coverRatioFromSheetHeight(
      tripSheetHeightPx(sheetPosRef.current),
    )
    if (mapStops.length === 0) {
      applyFocusViewport(DEFAULT_CENTER, 12)
      return
    }
    const fitted = fitMapToPoints(
      mapStops.map((s) => ({
        latitude: s.place.latitude,
        longitude: s.place.longitude,
      })),
      cover,
    )
    applyFocusViewport(fitted.center, fitted.scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStopsKey])

  const syncMapCenterFromUser = (
    center: { latitude: number; longitude: number } | null,
    scaleRaw?: number,
  ) => {
    mapUserGesturingRef.current = false
    if (center) {
      const latSpan =
        mapViewLatSpanRef.current > 0
          ? mapViewLatSpanRef.current
          : estimateMapLatSpan(
              scaleRaw ?? mapScaleRef.current,
              center.latitude,
            )
      const anchor = reverseOffsetCenterForSheet(
        center,
        sheetCoverRatioRef.current,
        latSpan,
      )
      // 用户拖/缩放后：同步受控中心，并反推锚点，避免随后被 follow 拽回
      suppressCenterFollowRef.current = true
      mapCenterDisplayRef.current = center
      setMapCenter(center)
      setFocusCoord(anchor)
    }
    // 仅缩放手势回写 scale；拖动结束回写会触发地图再应用缩放并略缩
    if (scaleRaw != null && Number.isFinite(scaleRaw)) {
      const next = Math.min(20, Math.max(3, Math.round(scaleRaw)))
      setMapScale((prev) => (prev === next ? prev : next))
    }
  }

  const onRegionChange = (e: {
    type?: string
    causedBy?: string
    detail?: Record<string, unknown>
  }) => {
    const detail = (e.detail || {}) as {
      type?: string
      causedBy?: string
      region?: {
        northeast?: { latitude: number; longitude: number }
        southwest?: { latitude: number; longitude: number }
      }
      centerLocation?: { latitude: number; longitude: number }
      latitude?: number
      longitude?: number
      scale?: number
    }
    const type = e.type || detail.type
    const causedBy = e.causedBy || detail.causedBy
    const isUserGesture =
      causedBy === 'gesture' || causedBy === 'drag' || causedBy === 'scale'

    if (type === 'begin') {
      if (isUserGesture) {
        mapUserGesturingRef.current = true
        cancelMapCenterAnim()
      }
      return
    }
    if (type !== 'end') return

    const span = readLatSpanFromRegion(detail.region)
    if (span != null && span > 0) {
      mapViewLatSpanRef.current = span
      setMapViewLatSpan(span)
    }

    if (!mapUserGesturingRef.current && !isUserGesture) return

    const centerFromEvent =
      detail.centerLocation ||
      (detail.latitude != null && detail.longitude != null
        ? { latitude: detail.latitude, longitude: detail.longitude }
        : null)
    const scaleRaw = causedBy === 'scale' ? detail.scale : undefined

    const finish = (center: typeof centerFromEvent) => {
      syncMapCenterFromUser(center, scaleRaw)
    }

    if (centerFromEvent) {
      finish(centerFromEvent)
      return
    }

    // 部分基础库 end 不带中心：查一次，避免解除冻结后被旧受控坐标拽回
    try {
      Taro.createMapContext(PLAN_MAP_ID).getCenterLocation({
        success: (res) => {
          finish({ latitude: res.latitude, longitude: res.longitude })
        },
        fail: () => finish(null),
      })
    } catch {
      finish(null)
    }
  }

  const markers = useMemo(() => {
    return mapStops.map((stop, index) => {
      const selected = stop.id === selectedStopId
      const icon = placeMarkerIcon(stop.place, selected)
      return {
        id: index + 1,
        latitude: stop.place.latitude,
        longitude: stop.place.longitude,
        width: icon.width,
        height: icon.height,
        iconPath: icon.iconPath,
        anchor: icon.anchor,
        zIndex: selected ? 20 : 10,
        ariaLabel: stop.place.name,
      }
    })
  }, [mapStops, selectedStopId])

  const markerStopById = useMemo(() => {
    const map = new Map<number, TripStopView>()
    mapStops.forEach((stop, index) => {
      map.set(index + 1, stop)
    })
    return map
  }, [mapStops])

  const sheetClass = [
    'sheet',
    'trip-sheet',
    sheetPos === 'top' ? 'sheet--top' : '',
    sheetPos === 'middle' ? 'sheet--middle' : '',
    sheetPos === 'bottom' ? 'sheet--bottom' : '',
    dragHeightPx != null ? 'sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showSheetBody = sheetPos !== 'bottom' || dragHeightPx != null

  const resolveHeightSnap = (heightPx: number): SheetPos => {
    const minH = tripSheetHeightPx('bottom')
    const maxH = tripSheetHeightPx('top')
    const t = (heightPx - minH) / Math.max(maxH - minH, 1)
    if (t < 0.25) return 'bottom'
    if (t < 0.75) return 'middle'
    return 'top'
  }

  const onSheetTouchStart = (e: { touches: Array<{ clientY: number }> }) => {
    const clientY = e.touches?.[0]?.clientY
    if (clientY == null) return
    dragMovedRef.current = false
    dragRef.current = {
      active: true,
      startY: clientY,
      startH: tripSheetHeightPx(sheetPos),
    }
    setDragHeightPx(tripSheetHeightPx(sheetPos))
  }

  const onSheetTouchMove = (e: { touches: Array<{ clientY: number }> }) => {
    const drag = dragRef.current
    if (!drag?.active) return
    const clientY = e.touches?.[0]?.clientY
    if (clientY == null) return
    const dy = clientY - drag.startY
    if (Math.abs(dy) > SHEET_TAP_SLOP_PX) dragMovedRef.current = true
    const minH = tripSheetHeightPx('bottom')
    const maxH = tripSheetHeightPx('top')
    const next = Math.min(maxH, Math.max(minH, drag.startH - dy))
    setDragHeightPx(next)
  }

  const onSheetTouchEnd = (e: {
    changedTouches: Array<{ clientY: number }>
  }) => {
    const drag = dragRef.current
    if (!drag?.active) return
    dragRef.current = null
    const clientY = e.changedTouches?.[0]?.clientY ?? drag.startY
    const dy = clientY - drag.startY
    const heightNow = Math.min(
      tripSheetHeightPx('top'),
      Math.max(tripSheetHeightPx('bottom'), drag.startH - dy),
    )
    const next = resolveHeightSnap(heightNow)
    setSheetPos(next)
    setDragHeightPx(null)
  }

  const focusStop = (stop: TripStopView) => {
    const nextPos: SheetPos = sheetPos === 'bottom' ? 'middle' : sheetPos
    setSelectedStopId(stop.id)
    if (nextPos !== sheetPos) setSheetPos(nextPos)
    applyFocusViewport(
      {
        latitude: stop.place.latitude,
        longitude: stop.place.longitude,
      },
      15,
    )
  }

  const onMarkerTap = (e: { detail: { markerId: number | string } }) => {
    const id = Number(e.detail.markerId)
    const stop = markerStopById.get(id)
    if (stop) focusStop(stop)
  }

  // 稳定回调身份，避免拖底栏等无关 setState 让 PlanMap 重渲染并把视野拽回
  const onRegionChangeRef = useRef(onRegionChange)
  onRegionChangeRef.current = onRegionChange
  const onMarkerTapRef = useRef(onMarkerTap)
  onMarkerTapRef.current = onMarkerTap
  const stableOnRegionChange = useRef(
    (e: {
      type?: string
      causedBy?: string
      detail?: Record<string, unknown>
    }) => onRegionChangeRef.current(e),
  ).current
  const stableOnMarkertap = useRef(
    (e: { detail: { markerId: number | string } }) => onMarkerTapRef.current(e),
  ).current
  const noop = useRef(() => {}).current

  return (
    <View className='trip-map'>
      <View className='trip-map__stage'>
        <PlanMap
          latitude={mapCenter.latitude}
          longitude={mapCenter.longitude}
          scale={mapScale}
          markers={markers as Array<Record<string, unknown>>}
          onRegionChange={stableOnRegionChange}
          onMarkertap={stableOnMarkertap}
          onPoiTap={noop}
          onClick={noop}
        />

        <View
          className={sheetClass}
          style={
            dragHeightPx != null ? { height: `${dragHeightPx}px` } : undefined
          }
        >
          <View
            className='sheet__grab'
            catchMove
            onTouchStart={onSheetTouchStart as never}
            onTouchMove={onSheetTouchMove as never}
            onTouchEnd={onSheetTouchEnd as never}
            onTouchCancel={onSheetTouchEnd as never}
          >
            <View className='sheet__handle'>
              <View className='sheet__handle-bar' />
            </View>
            <ScrollView
              scrollX
              className='trip-days'
              enhanced
              showScrollbar={false}
            >
              <View className='trip-days__row'>
                {days.map((day) => {
                  const active = day.datePart === (selectedDay?.datePart || '')
                  return (
                    <View
                      key={day.datePart}
                      className={`trip-days__item${
                        active ? ' trip-days__item--on' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDayKey(day.datePart)
                      }}
                    >
                      <Text className='trip-days__label'>{day.label}</Text>
                      <Text className='trip-days__week'>{day.weekday}</Text>
                    </View>
                  )
                })}
              </View>
            </ScrollView>
            <View className='trip-sheet__summary'>
              <Text className='trip-sheet__sub'>
                {dayStops.length > 0
                  ? `${dayStops.length} 个行程`
                  : '当天暂无行程'}
              </Text>
            </View>
          </View>

          {showSheetBody ? (
            <ScrollView scrollY className='sheet__body' enhanced showScrollbar>
              <View className='trip-sheet__list'>
                {dayStops.length === 0 ? (
                  <View className='trip-sheet__empty'>这一天还没有安排行程</View>
                ) : (
                  dayStops.map((stop, index) => {
                    const active = stop.id === selectedStopId
                    const axis = placeAxisMark(stop.place)
                    const AxisIcon = axis.icon
                    return (
                      <View
                        key={stop.id}
                        className={`trip-sheet__item${
                          active ? ' trip-sheet__item--on' : ''
                        }`}
                        onClick={() => focusStop(stop)}
                      >
                        <View
                          className='trip-sheet__dot'
                          style={{ backgroundColor: lightenColor(axis.color) }}
                        >
                          <AxisIcon size={14} color={axis.color} />
                        </View>
                        <View className='trip-sheet__body'>
                          <View className='trip-sheet__row'>
                            <Text className='trip-sheet__time'>
                              {formatClock(stop.expectedAt)}
                            </Text>
                            <Text className='trip-sheet__index'>
                              第 {index + 1} 站
                            </Text>
                          </View>
                          <Text className='trip-sheet__name'>
                            {stop.place.name}
                          </Text>
                          {!!stop.place.address && (
                            <Text className='trip-sheet__addr'>
                              {stop.place.address}
                            </Text>
                          )}
                        </View>
                      </View>
                    )
                  })
                )}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  )
}

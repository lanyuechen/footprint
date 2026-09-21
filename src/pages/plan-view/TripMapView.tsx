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
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import { formatClock } from '../../utils/datetime'
import { GroupedSortList, type SortGroup } from './GroupedSortList'
import { markerIconPath, placeAxisMark, lightenColor } from './place-axis'
import { buildTimelineYears, type TimelineDay } from './timeline-model'

type TripStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

type TripMapViewProps = {
  plan: TravelPlan
  places: CollectedPlace[]
  stops: TripStop[]
  onReorderGroups: (groups: SortGroup<TripStopView>[]) => void
}

const TRIP_MAP_ID = 'trip-map'
const TRIP_SHEET_BOTTOM_RPX = 180
const MARKER_CANVAS = { width: 1424, height: 1444 }
const MARKER_ANCHOR = { x: 0.5, y: (1018.56 + 200) / MARKER_CANVAS.height }

function tripSheetHeightPx(pos: SheetPos): number {
  return sheetHeightPx(pos, { bottomRpx: TRIP_SHEET_BOTTOM_RPX })
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

export function TripMapView({
  plan,
  places,
  stops,
  onReorderGroups,
}: TripMapViewProps) {
  const days = useMemo(() => {
    const years = buildTimelineYears(plan, stops, places)
    return years.flatMap((y) => y.days)
  }, [plan, stops, places])

  const [dayKey, setDayKey] = useState(() => days[0]?.datePart || '')
  const [sheetPos, setSheetPos] = useState<SheetPos>('bottom')
  const [selectedStopId, setSelectedStopId] = useState('')
  const [listScrollId, setListScrollId] = useState('')
  const [listScrollSeq, setListScrollSeq] = useState(0)
  const listScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [daysScrollLeft, setDaysScrollLeft] = useState(0)
  const daysScrollLeftRef = useRef(0)
  const daysScrollSeq = useRef(0)

  const selectedDay: TimelineDay | null =
    days.find((d) => d.datePart === dayKey) || days[0] || null

  const dayStops = selectedDay?.stops || []
  const mapStops = useMemo(() => uniqueStopsByPlace(dayStops), [dayStops])
  /** 不含顺序：集合变化才清选中 / 重拟合 */
  const mapStopsSetKey = useMemo(
    () =>
      [...mapStops.map((s) => s.id)]
        .sort()
        .join('|'),
    [mapStops],
  )

  const sortGroups: SortGroup<TripStopView>[] = useMemo(() => {
    if (!selectedDay) return []
    return [
      {
        id: selectedDay.datePart,
        title: selectedDay.label,
        subtitle: selectedDay.weekday,
        items: dayStops,
      },
    ]
  }, [selectedDay, dayStops])

  const seedPointsRef = useRef<
    Array<{ latitude: number; longitude: number }> | null
  >(null)
  if (seedPointsRef.current == null) {
    seedPointsRef.current = mapStops.map((s) => ({
      latitude: s.place.latitude,
      longitude: s.place.longitude,
    }))
  }

  const sheet = useSheetDrag({
    heightForPos: tripSheetHeightPx,
    pos: sheetPos,
    setPos: setSheetPos,
  })

  const camera = useSheetMapCamera({
    mapId: TRIP_MAP_ID,
    sheetHeightPx: sheet.sheetHeightNow,
    sheetDragging: sheet.sheetDragging,
    seedPoints: seedPointsRef.current,
  })

  useEffect(() => {
    if (days.length === 0) {
      setDayKey('')
      return
    }
    if (!days.some((d) => d.datePart === dayKey)) {
      setDayKey(days[0].datePart)
    }
  }, [days, dayKey])

  /** 选中日期滚到可视区正中；无法居中时夹到头/尾，尽量靠近中间 */
  useEffect(() => {
    if (!dayKey) return
    const seq = ++daysScrollSeq.current
    Taro.nextTick(() => {
      const page = Taro.getCurrentInstance().page
      const query = page
        ? Taro.createSelectorQuery().in(page)
        : Taro.createSelectorQuery()
      query.select('.trip-days').boundingClientRect()
      query.select('.trip-days').scrollOffset()
      query.select(`#trip-day-${dayKey}`).boundingClientRect()
      query.select('.trip-days__row').boundingClientRect()
      query.exec((res) => {
        if (seq !== daysScrollSeq.current) return
        const viewport = res?.[0] as
          | { left?: number; width?: number }
          | undefined
        const scroll = res?.[1] as { scrollLeft?: number } | undefined
        const item = res?.[2] as
          | { left?: number; width?: number }
          | undefined
        const row = res?.[3] as { width?: number } | undefined
        if (
          !viewport?.width ||
          !item?.width ||
          viewport.left == null ||
          item.left == null ||
          !row?.width
        ) {
          return
        }
        const currentLeft = scroll?.scrollLeft ?? daysScrollLeftRef.current
        const itemOffset =
          currentLeft + (item.left - viewport.left)
        const ideal =
          itemOffset + item.width / 2 - viewport.width / 2
        const maxScroll = Math.max(0, row.width - viewport.width)
        const next = Math.min(maxScroll, Math.max(0, ideal))
        if (Math.abs(next - currentLeft) < 1) return
        daysScrollLeftRef.current = next
        setDaysScrollLeft(next)
      })
    })
  }, [dayKey])

  useEffect(() => {
    return () => {
      if (listScrollTimer.current) clearTimeout(listScrollTimer.current)
    }
  }, [])

  const mapStopsSetKeyRef = useRef(mapStopsSetKey)
  const skipNextFit = useRef(true)

  useEffect(() => {
    setSelectedStopId((prev) =>
      prev && mapStops.some((s) => s.id === prev) ? prev : '',
    )
    if (skipNextFit.current) {
      skipNextFit.current = false
      mapStopsSetKeyRef.current = mapStopsSetKey
      return
    }
    if (mapStopsSetKeyRef.current === mapStopsSetKey) return
    mapStopsSetKeyRef.current = mapStopsSetKey
    camera.fitToPoints(
      mapStops.map((s) => ({
        latitude: s.place.latitude,
        longitude: s.place.longitude,
      })),
      { animate: false },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStopsSetKey])

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

  const requestListScrollTo = (stopId: string, delayMs = 0) => {
    const run = () => {
      setListScrollId(stopId)
      setListScrollSeq((n) => n + 1)
    }
    if (listScrollTimer.current) {
      clearTimeout(listScrollTimer.current)
      listScrollTimer.current = null
    }
    if (delayMs <= 0) {
      run()
      return
    }
    listScrollTimer.current = setTimeout(() => {
      listScrollTimer.current = null
      run()
    }, delayMs)
  }

  const focusStop = (
    stop: TripStopView,
    options?: { scrollList?: boolean },
  ) => {
    const expanding = sheetPos === 'bottom'
    const nextPos: SheetPos = expanding ? 'middle' : sheetPos
    setSelectedStopId(stop.id)
    if (nextPos !== sheetPos) setSheetPos(nextPos)
    camera.setFocusCoord({
      latitude: stop.place.latitude,
      longitude: stop.place.longitude,
    })
    if (!options?.scrollList) return
    requestListScrollTo(stop.id)
    // 底栏展开有高度动画，结束后再滚一次
    if (expanding) requestListScrollTo(stop.id, 360)
  }

  const sortItemHeight = useMemo(() => {
    try {
      const w =
        Taro.getWindowInfo?.().windowWidth ||
        Taro.getSystemInfoSync().windowWidth
      return Math.round((w * 148) / 750)
    } catch {
      return 74
    }
  }, [])

  const handleSortChange = (next: SortGroup<TripStopView>[]) => {
    const reordered = next[0]
    if (!reordered) return
    const groups = days.map((d) =>
      d.datePart === reordered.id
        ? reordered
        : {
            id: d.datePart,
            title: d.label,
            subtitle: d.weekday,
            items: d.stops,
          },
    )
    onReorderGroups(groups)
  }

  const sheetClass = [
    'sheet',
    'trip-sheet',
    sheetPos === 'top' ? 'sheet--top' : '',
    sheetPos === 'middle' ? 'sheet--middle' : '',
    sheetPos === 'bottom' ? 'sheet--bottom' : '',
    sheet.sheetDragging ? 'sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <View className='trip-map'>
      <SheetMapFrame
        mapId={TRIP_MAP_ID}
        camera={camera}
        sheet={sheet}
        sheetPos={sheetPos}
        markers={markers as Array<Record<string, unknown>>}
        className='trip-map__stage'
        mapClassName='map-stage__map'
        sheetClassName={sheetClass}
        grabClassName='sheet__grab'
        onMarkerTap={(e) => {
          const id = Number(e.detail.markerId)
          const stop = markerStopById.get(id)
          if (stop) focusStop(stop, { scrollList: true })
        }}
        header={
          <>
            <View className='sheet__handle'>
              <View className='sheet__handle-bar' />
            </View>
            <ScrollView
              scrollX
              className='trip-days'
              enhanced
              showScrollbar={false}
              scrollLeft={daysScrollLeft}
              scrollWithAnimation
              onScroll={(e) => {
                const left = e.detail.scrollLeft
                if (left == null || !Number.isFinite(left)) return
                daysScrollLeftRef.current = left
              }}
            >
              <View className='trip-days__row'>
                {days.map((day) => {
                  const active = day.datePart === (selectedDay?.datePart || '')
                  return (
                    <View
                      id={`trip-day-${day.datePart}`}
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
                  ? `${dayStops.length} 个行程 · 长按拖动排序`
                  : '当天暂无行程'}
              </Text>
            </View>
          </>
        }
        body={
          dayStops.length === 0 ? (
            <View className='trip-sheet__empty'>这一天还没有安排行程</View>
          ) : (
            <View className='trip-sheet__sort'>
              <GroupedSortList
                groups={sortGroups}
                headerHeight={0}
                itemHeight={sortItemHeight}
                layoutKey={selectedStopId}
                scrollToId={listScrollId}
                scrollToSeq={listScrollSeq}
                onItemClick={(id) => {
                  const stop = dayStops.find((s) => s.id === id)
                  if (stop) focusStop(stop)
                }}
                onChange={handleSortChange}
                renderItem={(stop, { dragging }) => {
                  const active = stop.id === selectedStopId && !dragging
                  const axis = placeAxisMark(stop.place)
                  const AxisIcon = axis.icon
                  const index = dayStops.findIndex((s) => s.id === stop.id)
                  return (
                    <View
                      id={`trip-stop-${stop.id}`}
                      className={`trip-sheet__item${
                        active ? ' trip-sheet__item--on' : ''
                      }`}
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
                            第 {index >= 0 ? index + 1 : 1} 站
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
                }}
              />
            </View>
          )
        }
      />
    </View>
  )
}

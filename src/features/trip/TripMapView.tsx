import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SheetMapFrame,
  sheetHeightPx,
  useRemountSelectedMarker,
  useSheetDrag,
  useSheetMapCamera,
  type SheetPos,
} from '../../components/sheet-map'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import { removePlanDay, reorderPlanDays, setPlanDayCount } from '../../services/storage'
import type { SortGroup } from './GroupedSortList'
import { buildTripDays, previewNextTripDay } from './trip-days'
import {
  TripAddHeader,
  TripAddList,
  TripConfirmBar,
} from './panels/TripAddPanel'
import {
  TripBrowseHeader,
  TripBrowseList,
  TripNameEditSheet,
  TripNoteEditSheet,
  type TripStopView,
} from './panels/TripBrowsePanel'
import { TripDayTabs } from './panels/TripDayTabs'
import { useTripPlacePick } from './panels/useTripPlacePick'
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight'
import {
  keyNodeSegmentsToDistanceMarkers,
  keyNodeSegmentsToPolylines,
  planKeyNodeRouteSegments,
  type KeyNodeRouteSegment,
} from './key-node-routes'
import {
  NUMBERED_DOT_DISPLAY_SIZE,
  NUMBERED_DOT_FALLBACK,
  NUMBERED_DOT_PRELOAD_COUNT,
  NUMBERED_DOT_SELECTED_SIZE,
  ensureNumberedDotMarkersRange,
  getNumberedDotMarkerPath,
  preloadNumberedDotMarkers,
} from './numbered-dot-markers'
import { placeMarkerCallout } from './marker-callout'

type TripMapViewProps = {
  plan: TravelPlan
  places: CollectedPlace[]
  stops: TripStop[]
  /** 是否绘制关键节点路径 */
  showRoutes?: boolean
  /** 是否展示路径距离气泡（需同时开启路径） */
  showRouteTips?: boolean
  onReorderGroups: (groups: SortGroup<TripStopView>[]) => void
  onRemoveStop: (stopId: string) => void
  onTripChanged?: () => void
}

const TRIP_MAP_ID = 'trip-map'
/** 底部档：把手 + 日期卡 + 「n 个行程」摘要 + 少量 padding，不露出添加按钮 */
const TRIP_SHEET_BOTTOM_RPX = 156

function tripSheetHeightPx(pos: SheetPos): number {
  return sheetHeightPx(pos, { bottomRpx: TRIP_SHEET_BOTTOM_RPX })
}

/** 圆形编号点：锚点为图片中心 */
function numberedDotMarker(selected: boolean, iconPath: string) {
  const size = selected
    ? NUMBERED_DOT_SELECTED_SIZE
    : NUMBERED_DOT_DISPLAY_SIZE
  return {
    iconPath,
    width: size,
    height: size,
    anchor: { x: 0.5, y: 0.5 },
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
  showRoutes = true,
  showRouteTips = true,
  onReorderGroups,
  onRemoveStop,
  onTripChanged,
}: TripMapViewProps) {
  const days = useMemo(() => {
    const years = buildTripDays(plan, stops, places)
    return years.flatMap((y) => y.days)
  }, [plan, stops, places])

  const nextDay = useMemo(() => previewNextTripDay(plan), [plan])

  const [dayKey, setDayKey] = useState(() =>
    days[0] != null ? String(days[0].dayIndex) : '',
  )
  const [sheetPos, setSheetPos] = useState<SheetPos>('top')
  const [adding, setAdding] = useState(false)
  const [addSearchFocus, setAddSearchFocus] = useState(false)
  const addKeyboardHeight = useKeyboardHeight(adding)
  const [notePickerStop, setNotePickerStop] = useState<TripStopView | null>(
    null,
  )
  const [namePickerStop, setNamePickerStop] = useState<TripStopView | null>(
    null,
  )
  const [selectedStopId, setSelectedStopId] = useState('')
  const [listScrollId, setListScrollId] = useState('')
  const [listScrollSeq, setListScrollSeq] = useState(0)
  const [dotIconTick, setDotIconTick] = useState(0)
  const listScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshDotIcons = useCallback(() => {
    setDotIconTick((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void preloadNumberedDotMarkers(NUMBERED_DOT_PRELOAD_COUNT).then(() => {
      if (!cancelled) refreshDotIcons()
    })
    return () => {
      cancelled = true
    }
  }, [plan.id, refreshDotIcons])

  const selectedDay =
    days.find((d) => String(d.dayIndex) === dayKey) || days[0] || null

  const dayStops = selectedDay?.stops || []
  const mapStops = useMemo(() => uniqueStopsByPlace(dayStops), [dayStops])
  const mapStopsSetKey = useMemo(
    () =>
      [...mapStops.map((s) => s.id)]
        .sort()
        .join('|'),
    [mapStops],
  )

  useEffect(() => {
    const need = mapStops.length
    if (need <= NUMBERED_DOT_PRELOAD_COUNT) return
    let cancelled = false
    void ensureNumberedDotMarkersRange(
      NUMBERED_DOT_PRELOAD_COUNT + 1,
      need,
    ).then(() => {
      if (!cancelled) refreshDotIcons()
    })
    return () => {
      cancelled = true
    }
  }, [mapStops.length, refreshDotIcons])

  const sortGroups: SortGroup<TripStopView>[] = useMemo(() => {
    if (!selectedDay) return []
    return [
      {
        id: String(selectedDay.dayIndex),
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

  const addingRef = useRef(adding)
  addingRef.current = adding
  const closeAddingRef = useRef<() => void>(() => {})

  const sheet = useSheetDrag({
    heightForPos: tripSheetHeightPx,
    pos: sheetPos,
    setPos: setSheetPos,
    onBeforeSnap: (next) => {
      if (next === 'bottom' && addingRef.current) {
        closeAddingRef.current()
      }
    },
  })

  const camera = useSheetMapCamera({
    mapId: TRIP_MAP_ID,
    sheetHeightPx: sheet.sheetHeightNow,
    sheetDragging: sheet.sheetDragging,
    seedPoints: seedPointsRef.current,
  })

  const getMapCenter = useCallback(
    () => camera.focusCoord,
    [camera.focusCoord],
  )

  const exitAdding = useCallback(() => {
    setAddSearchFocus(false)
    setAdding(false)
  }, [])

  const placePick = useTripPlacePick({
    planId: plan.id,
    dayIndex: selectedDay?.dayIndex ?? 0,
    places,
    favoriteIds: plan.placeIds,
    getMapCenter,
    onFocusMap: (coord) => camera.setFocusCoord(coord),
    onDone: () => {
      exitAdding()
      onTripChanged?.()
    },
    onPlacesChanged: () => onTripChanged?.(),
  })

  const resetPick = placePick.reset
  const syncFavorites = placePick.syncFavorites
  const closeAdding = useCallback(() => {
    syncFavorites()
    resetPick()
    exitAdding()
    onTripChanged?.()
  }, [syncFavorites, resetPick, exitAdding, onTripChanged])
  closeAddingRef.current = closeAdding

  const confirmAdding = useCallback(() => {
    if (placePick.tripPickCount === 0) {
      closeAdding()
      return
    }
    placePick.confirm()
    resetPick()
  }, [placePick, closeAdding, resetPick])

  // 添加页：panel 离开顶部（划到中部/底部）时搜索失焦收起键盘
  useEffect(() => {
    if (!adding) return
    if (sheetPos !== 'top') setAddSearchFocus(false)
  }, [adding, sheetPos])

  const handleAddDay = useCallback(() => {
    const next = previewNextTripDay(plan)
    if (!next) return
    setPlanDayCount(plan.id, next.dayIndex + 1)
    setDayKey(String(next.dayIndex))
    onTripChanged?.()
  }, [plan, onTripChanged])

  const handleRemoveDay = useCallback(() => {
    if (!selectedDay) return
    const removeAt = selectedDay.dayIndex
    Taro.showModal({
      title: '移除当日',
      content: `确定移除 ${selectedDay.label}？后续日期将依次向前补齐。`,
      success: (res) => {
        if (!res.confirm) return
        const updated = removePlanDay(plan.id, removeAt)
        if (!updated) {
          Taro.showToast({ title: '无法移除', icon: 'none' })
          return
        }
        const nextCount = Math.max(1, updated.dayCount)
        const nextKey = Math.min(removeAt, nextCount - 1)
        setDayKey(String(nextKey))
        setSelectedStopId('')
        onTripChanged?.()
      },
    })
  }, [plan.id, selectedDay, onTripChanged])

  const handleReorderDays = useCallback(
    (fromIndex: number, toIndex: number) => {
      const result = reorderPlanDays(plan.id, fromIndex, toIndex)
      if (!result) return
      const selected = Number(dayKey)
      if (Number.isFinite(selected) && result.map[selected] != null) {
        setDayKey(String(result.map[selected]))
      }
      setSelectedStopId('')
      onTripChanged?.()
    },
    [plan.id, dayKey, onTripChanged],
  )

  useEffect(() => {
    if (days.length === 0) {
      setDayKey('')
      return
    }
    if (!days.some((d) => String(d.dayIndex) === dayKey)) {
      setDayKey(String(days[0].dayIndex))
    }
  }, [days, dayKey])

  useEffect(() => {
    return () => {
      if (listScrollTimer.current) clearTimeout(listScrollTimer.current)
    }
  }, [])

  const mapStopsSetKeyRef = useRef(mapStopsSetKey)
  const skipNextFit = useRef(true)
  const prevSheetPosRef = useRef(sheetPos)

  useEffect(() => {
    if (adding) return
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
  }, [mapStopsSetKey, adding])

  /** 从顶栏收起露出地图时，按当日点重新 fit（首屏 top 时地图高度≈0） */
  useEffect(() => {
    const prev = prevSheetPosRef.current
    prevSheetPosRef.current = sheetPos
    if (adding) return
    if (prev !== 'top' || sheetPos === 'top') return
    if (mapStops.length === 0) return
    const timer = setTimeout(() => {
      camera.fitToPoints(
        mapStops.map((s) => ({
          latitude: s.place.latitude,
          longitude: s.place.longitude,
        })),
        { animate: true },
      )
    }, 80)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetPos, adding, mapStopsSetKey])

  const browseMarkers = useMemo(() => {
    // dotIconTick：动态图生成完成后触发刷新
    void dotIconTick
    return mapStops.map((stop, index) => {
      const selected = stop.id === selectedStopId
      const num = index + 1
      const iconPath =
        getNumberedDotMarkerPath(num) || NUMBERED_DOT_FALLBACK
      const icon = numberedDotMarker(selected, iconPath)
      return {
        id: num,
        latitude: stop.place.latitude,
        longitude: stop.place.longitude,
        width: icon.width,
        height: icon.height,
        iconPath: icon.iconPath,
        anchor: icon.anchor,
        zIndex: selected ? 20 : 10,
        ariaLabel: stop.place.name,
        ...(selected ? { callout: placeMarkerCallout(stop.place) } : {}),
      }
    })
  }, [mapStops, selectedStopId, dotIconTick])

  const keyRouteSig = useMemo(() => {
    const first = dayStops[0]
    const firstPart = first
      ? `first:${first.id}:${first.place.latitude.toFixed(5)},${first.place.longitude.toFixed(5)}`
      : ''
    const keys = dayStops
      .filter((s) => s.isKeyNode)
      .map(
        (s) =>
          `${s.id}:${s.travelMode || 'walking'}:${s.place.latitude.toFixed(5)},${s.place.longitude.toFixed(5)}`,
      )
      .join('|')
    if (!keys) return ''
    return `${firstPart}#${keys}`
  }, [dayStops])

  const [routeSegments, setRouteSegments] = useState<KeyNodeRouteSegment[]>(
    [],
  )

  useEffect(() => {
    if (!showRoutes || adding || !keyRouteSig) {
      setRouteSegments([])
      return
    }
    const signal = { cancelled: false }
    void planKeyNodeRouteSegments(dayStops, signal).then((segments) => {
      if (signal.cancelled) return
      setRouteSegments(segments)
    })
    return () => {
      signal.cancelled = true
    }
    // dayStops 由 keyRouteSig 代表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoutes, adding, keyRouteSig])

  const routePolylines = useMemo(
    () => keyNodeSegmentsToPolylines(routeSegments),
    [routeSegments],
  )

  const routeDistanceMarkers = useMemo(
    () => keyNodeSegmentsToDistanceMarkers(routeSegments),
    [routeSegments],
  )

  const routeLegByToStopId = useMemo(() => {
    const map: Record<
      string,
      { distanceMeters: number; durationSeconds?: number }
    > = {}
    for (const seg of routeSegments) {
      if (seg.distanceMeters > 0) {
        map[seg.toStopId] = {
          distanceMeters: seg.distanceMeters,
          ...(seg.durationSeconds && seg.durationSeconds > 0
            ? { durationSeconds: seg.durationSeconds }
            : {}),
        }
      }
    }
    return map
  }, [routeSegments])

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
    setSelectedStopId(stop.id)
    camera.setFocusCoord({
      latitude: stop.place.latitude,
      longitude: stop.place.longitude,
    })
    if (options?.scrollList) requestListScrollTo(stop.id)
  }

  const handleSortChange = (next: SortGroup<TripStopView>[]) => {
    const reordered = next[0]
    if (!reordered) return
    const groups = days.map((d) =>
      String(d.dayIndex) === reordered.id
        ? reordered
        : {
            id: String(d.dayIndex),
            title: d.label,
            subtitle: d.weekday,
            items: d.stops,
          },
    )
    onReorderGroups(groups)
  }

  const openAddTrip = () => {
    if (!selectedDay) {
      Taro.showToast({ title: '请先选择日期', icon: 'none' })
      return
    }
    setSelectedStopId('')
    placePick.reset()
    setSheetPos('top')
    setAddSearchFocus(true)
    setAdding(true)
  }

  const sheetClass = [
    'sheet',
    'trip-sheet',
    adding ? 'trip-sheet--adding' : '',
    sheetPos === 'top' ? 'sheet--top' : '',
    sheetPos === 'middle' ? 'sheet--middle' : '',
    sheetPos === 'bottom' ? 'sheet--bottom' : '',
    sheet.sheetDragging ? 'sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const markers = adding ? placePick.markers : browseMarkers
  const selectedMarkerId = useMemo(() => {
    if (adding) return placePick.selectedMarkerId
    if (!selectedStopId) return null
    const idx = mapStops.findIndex((s) => s.id === selectedStopId)
    return idx >= 0 ? idx + 1 : null
  }, [adding, placePick.selectedMarkerId, selectedStopId, mapStops])
  const remountedMarkers = useRemountSelectedMarker(
    markers as Array<Record<string, unknown>>,
    selectedMarkerId,
  )
  const displayMarkers = useMemo(() => {
    if (
      adding ||
      !showRoutes ||
      !showRouteTips ||
      routeDistanceMarkers.length === 0
    ) {
      return remountedMarkers
    }
    return [
      ...remountedMarkers,
      ...(routeDistanceMarkers as Array<Record<string, unknown>>),
    ]
  }, [
    adding,
    showRoutes,
    showRouteTips,
    remountedMarkers,
    routeDistanceMarkers,
  ])
  const activeDayKey =
    selectedDay != null ? String(selectedDay.dayIndex) : dayKey

  return (
    <View className='trip-map'>
      <SheetMapFrame
        mapId={TRIP_MAP_ID}
        camera={camera}
        sheet={sheet}
        sheetPos={sheetPos}
        markers={displayMarkers}
        polyline={
          adding || !showRoutes
            ? undefined
            : (routePolylines as Array<Record<string, unknown>>)
        }
        className='trip-map__stage'
        mapClassName='map-stage__map'
        sheetClassName={sheetClass}
        grabClassName='sheet__grab'
        onMarkerTap={(e) => {
          const id = Number(e.detail.markerId)
          if (adding) {
            placePick.onMarkerTap(id)
            return
          }
          const stop = markerStopById.get(id)
          if (stop) focusStop(stop, { scrollList: true })
        }}
        onPoiTap={adding ? placePick.onMapPoiTap : undefined}
        onMapClick={adding ? placePick.onMapTap : undefined}
        header={
          adding ? (
            <TripAddHeader
              keyword={placePick.keyword}
              onKeywordChange={placePick.setKeyword}
              focused={addSearchFocus}
              onFocus={() => {
                setAddSearchFocus(true)
                setSheetPos('top')
              }}
              onBlur={() => setAddSearchFocus(false)}
            />
          ) : (
            <TripBrowseHeader
              dayStopsCount={dayStops.length}
              dayTabs={
                <TripDayTabs
                  days={days}
                  dayKey={activeDayKey}
                  onSelect={setDayKey}
                  nextDay={
                    nextDay
                      ? { label: nextDay.label, weekday: nextDay.weekday }
                      : undefined
                  }
                  onAddDay={handleAddDay}
                  onReorder={handleReorderDays}
                />
              }
              onAddTrip={openAddTrip}
            />
          )
        }
        body={
          adding ? (
            <TripAddList
              keyword={placePick.keyword}
              searching={placePick.searching}
              hasSearched={placePick.hasSearched}
              results={placePick.results}
              places={placePick.favoritePlaces}
              selectedPlace={placePick.selectedPlace}
              mapPickedPlace={placePick.mapPickedPlace}
              isPlacePicked={placePick.isPlacePicked}
              isFavorited={placePick.isFavorited}
              keyboardHeight={addKeyboardHeight}
              onSelectPlace={(place, source) => {
                placePick.selectPlace(place, source)
                if ((source ?? 'list') === 'list') {
                  setSheetPos('middle')
                }
              }}
              onTogglePick={placePick.togglePickByPlace}
              onToggleCollected={placePick.toggleCollectedPick}
              onToggleFavorite={placePick.toggleFavorite}
            />
          ) : (
            <TripBrowseList
              dayStops={dayStops}
              sortGroups={sortGroups}
              selectedStopId={selectedStopId}
              listScrollId={listScrollId}
              listScrollSeq={listScrollSeq}
              canRemoveDay={Math.max(1, plan.dayCount || 1) > 1}
              onItemClick={(id) => {
                const stop = dayStops.find((s) => s.id === id)
                if (stop) focusStop(stop)
              }}
              onDragStart={() => {
                setSelectedStopId('')
                setListScrollId('')
              }}
              onChange={handleSortChange}
              onEditStop={(stop) => {
                setNotePickerStop(null)
                setNamePickerStop(null)
                setSelectedStopId(stop.id)
                Taro.navigateTo({
                  url:
                    `/pages/stop-edit/index?planId=${encodeURIComponent(plan.id)}` +
                    `&stopId=${encodeURIComponent(stop.id)}`,
                  events: {
                    saved: (data: { dayIndex: number; stopId: string }) => {
                      setDayKey(String(data.dayIndex))
                      setSelectedStopId(data.stopId)
                      onTripChanged?.()
                    },
                  },
                })
              }}
              onRemoveStop={(stopId) => {
                onRemoveStop(stopId)
                setSelectedStopId('')
              }}
              onPickName={(stop) => {
                setNotePickerStop(null)
                setSelectedStopId(stop.id)
                setNamePickerStop(stop)
              }}
              onPickNote={(stop) => {
                setNamePickerStop(null)
                setSelectedStopId(stop.id)
                setNotePickerStop(stop)
              }}
              onStopUpdated={() => onTripChanged?.()}
              onRemoveDay={handleRemoveDay}
              routeLegByToStopId={routeLegByToStopId}
              quickEditEnabled={sheetPos === 'top'}
            />
          )
        }
      />
      {adding ? (
        <TripConfirmBar
          count={placePick.tripPickCount}
          keyboardHeight={addKeyboardHeight}
          onCancel={closeAdding}
          onConfirm={confirmAdding}
        />
      ) : null}
      <TripNameEditSheet
        open={namePickerStop != null}
        stop={namePickerStop}
        onClose={() => setNamePickerStop(null)}
        onSaved={() => {
          setNamePickerStop(null)
          onTripChanged?.()
        }}
      />
      <TripNoteEditSheet
        open={notePickerStop != null}
        stop={notePickerStop}
        onClose={() => setNotePickerStop(null)}
        onSaved={() => {
          setNotePickerStop(null)
          onTripChanged?.()
        }}
      />
    </View>
  )
}

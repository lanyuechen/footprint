import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import type { CollectedPlace, PlaceInfo } from '../../../types'
import {
  distanceMeters,
  getUserLocation,
  lookupMapPlace,
  searchPlaces,
  type UserLocation,
} from '../../../services/amap'
import { addStopsToDay, ensureFavoritePlace, ensurePlaceRecord, unfavoritePlace } from '../../../services/storage'
import {
  MARKER_ID_SEARCH,
  SEARCH_DEBOUNCE_MS,
  nearlySameCoord,
} from '../../../components/sheet-map'
import { isSamePlace } from '../place-info'
import {
  NUMBERED_DOT_DISPLAY_SIZE,
  NUMBERED_DOT_FALLBACK,
  NUMBERED_DOT_PRELOAD_COUNT,
  NUMBERED_DOT_SELECTED_SIZE,
  ensureNumberedDotMarker,
  ensureNumberedDotMarkersRange,
  getNumberedDotMarkerPath,
  preloadNumberedDotMarkers,
} from '../numbered-dot-markers'
import { placeMarkerCallout } from '../marker-callout'

type FocusCoord = { latitude: number; longitude: number }

function numberedDotIcon(num: number, selected: boolean) {
  const size = selected
    ? NUMBERED_DOT_SELECTED_SIZE
    : NUMBERED_DOT_DISPLAY_SIZE
  return {
    iconPath: getNumberedDotMarkerPath(num) || NUMBERED_DOT_FALLBACK,
    width: size,
    height: size,
    anchor: { x: 0.5, y: 0.5 },
  }
}

export type UseTripPlacePickOptions = {
  planId: string
  dayIndex: number
  /** 计划全部地点（含仅行程引用） */
  places: CollectedPlace[]
  /** 当前收藏 id 列表（plan.placeIds） */
  favoriteIds: string[]
  /** 搜索中心：当前地图焦点（用 ref 读取，避免打断防抖） */
  getMapCenter: () => FocusCoord
  onFocusMap: (coord: FocusCoord) => void
  onDone: () => void
  onPlacesChanged?: () => void
}

export function useTripPlacePick({
  planId,
  dayIndex,
  places,
  favoriteIds,
  getMapCenter,
  onFocusMap,
  onDone,
  onPlacesChanged,
}: UseTripPlacePickOptions) {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PlaceInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<PlaceInfo | null>(null)
  const [pinnedSearchPlace, setPinnedSearchPlace] = useState<PlaceInfo | null>(
    null,
  )
  const [mapPickedPlace, setMapPickedPlace] = useState<PlaceInfo | null>(null)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [pendingPlace, setPendingPlace] = useState<PlaceInfo | null>(null)
  /** 会话内待新增收藏 */
  const [favAdd, setFavAdd] = useState<PlaceInfo[]>([])
  /** 会话内待取消收藏的 placeId */
  const [favRemoveIds, setFavRemoveIds] = useState<string[]>([])

  const searchSeq = useRef(0)
  const lastQueryRef = useRef('')
  const mapPoiSeq = useRef(0)
  const getMapCenterRef = useRef(getMapCenter)
  getMapCenterRef.current = getMapCenter
  const onFocusMapRef = useRef(onFocusMap)
  onFocusMapRef.current = onFocusMap
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favRemoveSet = useMemo(() => new Set(favRemoveIds), [favRemoveIds])
  const [dotIconTick, setDotIconTick] = useState(0)

  const refreshDotIcons = useCallback(() => {
    setDotIconTick((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void preloadNumberedDotMarkers().then(() => {
      if (!cancelled) refreshDotIcons()
    })
    return () => {
      cancelled = true
    }
  }, [refreshDotIcons])

  useEffect(() => {
    let cancelled = false
    getUserLocation().then((loc) => {
      if (!cancelled && loc) setUserLocation(loc)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const q = keyword.trim()
    if (!q) {
      lastQueryRef.current = ''
      setResults([])
      setSearching(false)
      setHasSearched(false)
      return
    }
    if (q === lastQueryRef.current) return
    const seq = ++searchSeq.current
    setSearching(true)
    const timer = setTimeout(() => {
      lastQueryRef.current = q
      searchPlaces(q, {
        mapCenter: getMapCenterRef.current(),
        from: userLocation,
      })
        .then((list) => {
          if (seq !== searchSeq.current) return
          setResults(list)
          setHasSearched(true)
          setSearching(false)
        })
        .catch(() => {
          if (seq !== searchSeq.current) return
          setResults([])
          setHasSearched(true)
          setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword, userLocation])

  const placeFromMap = useCallback(
    (place: PlaceInfo): PlaceInfo => {
      if (!userLocation) return place
      return {
        ...place,
        distanceMeters: distanceMeters(userLocation, place),
      }
    },
    [userLocation],
  )

  const findActiveCollected = useCallback(
    (place: PlaceInfo) => places.find((p) => isSamePlace(p.place, place)),
    [places],
  )

  const isFavorited = useCallback(
    (place: PlaceInfo) => {
      if (favAdd.some((p) => isSamePlace(p, place))) return true
      const existing = findActiveCollected(place)
      if (!existing) return false
      if (favRemoveSet.has(existing.id)) return false
      return favoriteIdSet.has(existing.id)
    },
    [favAdd, findActiveCollected, favRemoveSet, favoriteIdSet],
  )

  /** 已收藏列表：会话内取消收藏仍留在列表，关闭同步后下次才消失 */
  const favoritePlaces = useMemo((): CollectedPlace[] => {
    const kept = places.filter((p) => favoriteIdSet.has(p.id))
    const drafts: CollectedPlace[] = favAdd
      .filter((place) => !kept.some((p) => isSamePlace(p.place, place)))
      .map((place, index) => ({
        id: `__draft_fav_${index}`,
        planId,
        place,
        createdAt: '',
        updatedAt: '',
      }))
    return [...drafts, ...kept]
  }, [places, favoriteIdSet, favAdd, planId])

  const isPlacePicked = useCallback(
    (place: PlaceInfo) => {
      if (pendingPlace && isSamePlace(pendingPlace, place)) return true
      const collected = findActiveCollected(place)
      if (collected) return pickedIds.includes(collected.id)
      return false
    },
    [findActiveCollected, pickedIds, pendingPlace],
  )

  /** 已收藏地点多选（加入行程） */
  const toggleCollectedPick = useCallback(
    (point: CollectedPlace) => {
      if (point.id.startsWith('__draft_fav_')) {
        setPendingPlace((prev) =>
          prev && isSamePlace(prev, point.place) ? null : point.place,
        )
        setSelectedPlace(point.place)
        setMapPickedPlace(null)
        onFocusMapRef.current({
          latitude: point.place.latitude,
          longitude: point.place.longitude,
        })
        return
      }
      setPendingPlace((prev) =>
        prev && isSamePlace(prev, point.place) ? null : prev,
      )
      setPickedIds((prev) =>
        prev.includes(point.id)
          ? prev.filter((id) => id !== point.id)
          : [...prev, point.id],
      )
      setSelectedPlace(point.place)
      setMapPickedPlace(null)
      onFocusMapRef.current({
        latitude: point.place.latitude,
        longitude: point.place.longitude,
      })
    },
    [],
  )

  /** 仅改会话内收藏态，关闭添加页时再写入存储 */
  const toggleFavorite = useCallback(
    (place: PlaceInfo) => {
      if (isFavorited(place)) {
        setFavAdd((prev) => prev.filter((p) => !isSamePlace(p, place)))
        const existing = findActiveCollected(place)
        if (existing && favoriteIdSet.has(existing.id)) {
          setFavRemoveIds((prev) =>
            prev.includes(existing.id) ? prev : [...prev, existing.id],
          )
        }
        return
      }
      setFavRemoveIds((prev) => {
        const existing = findActiveCollected(place)
        if (!existing) return prev
        return prev.filter((id) => id !== existing.id)
      })
      const existing = findActiveCollected(place)
      if (existing && favoriteIdSet.has(existing.id)) return
      setFavAdd((prev) =>
        prev.some((p) => isSamePlace(p, place)) ? prev : [...prev, place],
      )
    },
    [isFavorited, findActiveCollected, favoriteIdSet],
  )

  const syncFavorites = useCallback(() => {
    let changed = false
    for (const id of favRemoveIds) {
      if (unfavoritePlace(id)) changed = true
    }
    for (const place of favAdd) {
      ensureFavoritePlace({ planId, place })
      changed = true
    }
    if (changed) onPlacesChanged?.()
    setFavAdd([])
    setFavRemoveIds([])
  }, [favRemoveIds, favAdd, planId, onPlacesChanged])

  const togglePickByPlace = useCallback(
    (place: PlaceInfo) => {
      const collected = findActiveCollected(place)
      if (collected) {
        toggleCollectedPick(collected)
        return
      }
      setPendingPlace((prev) => {
        if (prev && isSamePlace(prev, place)) return null
        return place
      })
      setSelectedPlace(place)
      setPinnedSearchPlace(place)
      setMapPickedPlace(null)
      onFocusMapRef.current({
        latitude: place.latitude,
        longitude: place.longitude,
      })
    },
    [findActiveCollected, toggleCollectedPick],
  )

  const selectPlace = useCallback(
    (item: PlaceInfo, source: 'map' | 'list' = 'list') => {
      const next = source === 'map' ? placeFromMap(item) : item
      setPinnedSearchPlace(next)
      setSelectedPlace(next)
      setMapPickedPlace(source === 'map' ? next : null)
      setPendingPlace(next)
      onFocusMapRef.current({
        latitude: next.latitude,
        longitude: next.longitude,
      })
    },
    [placeFromMap],
  )

  const onMapPoiTap = useCallback(
    (e: {
      detail: { name?: string; latitude?: number; longitude?: number }
    }) => {
      const { name, latitude, longitude } = e.detail || {}
      if (latitude == null || longitude == null) return
      const label = name?.trim() || '地图选点'
      const fallback: PlaceInfo = {
        name: label,
        address: '',
        latitude,
        longitude,
      }
      const seq = ++mapPoiSeq.current
      selectPlace(fallback, 'map')
      void lookupMapPlace(label, { latitude, longitude })
        .then((place) => {
          if (seq !== mapPoiSeq.current || !place) return
          const next = placeFromMap(place)
          setMapPickedPlace(next)
          setPinnedSearchPlace(next)
          setSelectedPlace(next)
          setPendingPlace(next)
          if (
            !nearlySameCoord(
              { latitude: next.latitude, longitude: next.longitude },
              { latitude, longitude },
            )
          ) {
            onFocusMapRef.current({
              latitude: next.latitude,
              longitude: next.longitude,
            })
          }
        })
        .catch(() => {})
    },
    [selectPlace, placeFromMap],
  )

  const tripPickCount = useMemo(() => {
    const ids = new Set(pickedIds)
    if (pendingPlace) {
      const existing = findActiveCollected(pendingPlace)
      if (existing) ids.add(existing.id)
      else return ids.size + 1
    }
    return ids.size
  }, [pickedIds, pendingPlace, findActiveCollected])

  const confirm = useCallback(() => {
    try {
      syncFavorites()
      if (tripPickCount === 0) {
        onDone()
        return
      }
      const placeIds = [...pickedIds]
      if (pendingPlace) {
        // 加入行程不自动收藏，仅保证有地点记录可引用
        const record = ensurePlaceRecord({ planId, place: pendingPlace })
        if (!placeIds.includes(record.id)) placeIds.push(record.id)
      }
      const created = addStopsToDay({ planId, dayIndex, placeIds })
      Taro.showToast({
        title: created.length > 0 ? `已添加 ${created.length} 个` : '未添加',
        icon: created.length > 0 ? 'success' : 'none',
      })
      if (created.length > 0) onPlacesChanged?.()
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }, [
    tripPickCount,
    syncFavorites,
    pickedIds,
    pendingPlace,
    planId,
    dayIndex,
    onDone,
    onPlacesChanged,
  ])

  const reset = useCallback(() => {
    setKeyword('')
    setResults([])
    setSearching(false)
    setHasSearched(false)
    setSelectedPlace(null)
    setPinnedSearchPlace(null)
    setMapPickedPlace(null)
    setPickedIds([])
    setPendingPlace(null)
    setFavAdd([])
    setFavRemoveIds([])
    lastQueryRef.current = ''
  }, [])

  const markers = useMemo(() => {
    void dotIconTick
    const list = favoritePlaces.map((p, index) => {
      const num = index + 1
      const selected =
        selectedPlace != null && isSamePlace(p.place, selectedPlace)
      const icon = numberedDotIcon(num, selected)
      return {
        id: index + 1,
        latitude: p.place.latitude,
        longitude: p.place.longitude,
        width: icon.width,
        height: icon.height,
        iconPath: icon.iconPath,
        anchor: icon.anchor,
        zIndex: selected ? 20 : 10,
        ariaLabel: p.place.name,
        ...(selected ? { callout: placeMarkerCallout(p.place) } : {}),
      }
    })

    const extraPlace =
      pinnedSearchPlace &&
      !favoritePlaces.some((p) => isSamePlace(p.place, pinnedSearchPlace))
        ? pinnedSearchPlace
        : null

    if (extraPlace) {
      const searchIdx = results.findIndex((r) => isSamePlace(r, extraPlace))
      /** 搜索结果用列表序号；纯地图选点对应「选中地点」为 1 */
      const num = searchIdx >= 0 ? searchIdx + 1 : 1
      const icon = numberedDotIcon(num, true)
      list.push({
        id: MARKER_ID_SEARCH,
        latitude: extraPlace.latitude,
        longitude: extraPlace.longitude,
        width: icon.width,
        height: icon.height,
        iconPath: icon.iconPath,
        anchor: icon.anchor,
        zIndex: 30,
        ariaLabel: extraPlace.name,
        callout: placeMarkerCallout(extraPlace),
      })
    }
    return list
  }, [
    favoritePlaces,
    pinnedSearchPlace,
    selectedPlace,
    results,
    dotIconTick,
  ])

  const selectedMarkerId = useMemo(() => {
    const extraPlace =
      pinnedSearchPlace &&
      !favoritePlaces.some((p) => isSamePlace(p.place, pinnedSearchPlace))
        ? pinnedSearchPlace
        : null
    if (extraPlace) return MARKER_ID_SEARCH
    if (!selectedPlace) return null
    const idx = favoritePlaces.findIndex((p) =>
      isSamePlace(p.place, selectedPlace),
    )
    return idx >= 0 ? idx + 1 : null
  }, [favoritePlaces, pinnedSearchPlace, selectedPlace])

  useEffect(() => {
    const nums: number[] = []
    for (let i = 1; i <= favoritePlaces.length; i++) nums.push(i)
    if (
      pinnedSearchPlace &&
      !favoritePlaces.some((p) => isSamePlace(p.place, pinnedSearchPlace))
    ) {
      const searchIdx = results.findIndex((r) =>
        isSamePlace(r, pinnedSearchPlace),
      )
      nums.push(searchIdx >= 0 ? searchIdx + 1 : 1)
    }
    const maxNum = nums.reduce((m, n) => Math.max(m, n), 0)
    if (maxNum <= 0) return
    let cancelled = false
    const run =
      maxNum <= NUMBERED_DOT_PRELOAD_COUNT
        ? Promise.all(nums.map((n) => ensureNumberedDotMarker(n).catch(() => null)))
        : ensureNumberedDotMarkersRange(1, maxNum)
    void run.then(() => {
      if (!cancelled) refreshDotIcons()
    })
    return () => {
      cancelled = true
    }
  }, [favoritePlaces, pinnedSearchPlace, results, refreshDotIcons])

  const onMarkerTap = useCallback(
    (markerId: number) => {
      if (markerId === MARKER_ID_SEARCH && pinnedSearchPlace) {
        selectPlace(pinnedSearchPlace, 'list')
        return
      }
      const point = favoritePlaces[markerId - 1]
      if (point) toggleCollectedPick(point)
    },
    [pinnedSearchPlace, favoritePlaces, selectPlace, toggleCollectedPick],
  )

  return {
    keyword,
    setKeyword,
    results,
    searching,
    hasSearched,
    selectedPlace,
    mapPickedPlace,
    tripPickCount,
    isPlacePicked,
    isFavorited,
    favoritePlaces,
    toggleCollectedPick,
    togglePickByPlace,
    toggleFavorite,
    syncFavorites,
    selectPlace,
    onMapPoiTap,
    onMarkerTap,
    markers,
    selectedMarkerId,
    confirm,
    reset,
  }
}

export type TripPlacePickApi = ReturnType<typeof useTripPlacePick>

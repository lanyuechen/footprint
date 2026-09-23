import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import {
  deleteStop,
  getPlan,
  getPlanMapFilterPref,
  getPlanTypeFilterPref,
  listAllPlacesByPlan,
  listStopsByPlan,
  reorderPlanStops,
  setPlanTypeFilterKeys,
} from '../../services/storage'
import {
  TripMapView,
  TypeFilter,
  collectPlaceTypeOptions,
  filterStopsByPlaceType,
  placeTypeFilterKey,
  preloadNumberedDotMarkers,
} from '../../features/trip'
import './index.scss'

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((k) => set.has(k))
}

function loadTypeFilterKeys(planId: string, allTypeKeys: string[]): string[] {
  if (allTypeKeys.length === 0) return []
  const pref = getPlanTypeFilterPref(planId)
  if (!pref) return allTypeKeys
  const keySet = new Set(allTypeKeys)
  const kept = pref.selected.filter((k) => keySet.has(k))
  const wasAllSelected = sameKeys(pref.selected, pref.available)
  if (wasAllSelected) return allTypeKeys
  return kept
}

function reconcileTypeFilterKeys(
  prev: string[],
  allTypeKeys: string[],
): string[] {
  if (allTypeKeys.length === 0) return []
  const keySet = new Set(allTypeKeys)
  const kept = prev.filter((k) => keySet.has(k))
  const missing = allTypeKeys.filter((k) => !kept.includes(k))
  const hadAllExisting =
    prev.length > 0 &&
    missing.length + kept.length === allTypeKeys.length &&
    allTypeKeys
      .filter((k) => !missing.includes(k))
      .every((k) => kept.includes(k))
  if (hadAllExisting) return allTypeKeys
  if (prev.length === 0) return []
  if (kept.length === 0) return allTypeKeys
  return kept
}

export default function TripEditPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [stops, setStops] = useState<TripStop[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTypeKeys, setFilterTypeKeys] = useState<string[]>([])
  const [showRoutes, setShowRoutes] = useState(true)
  const [showRouteTips, setShowRouteTips] = useState(true)
  const filterHydratedPlanRef = useRef('')
  const planIdRef = useRef(planId)
  planIdRef.current = planId

  const typeOptions = useMemo(() => collectPlaceTypeOptions(places), [places])
  const allTypeKeys = useMemo(
    () => typeOptions.map((o) => placeTypeFilterKey(o)),
    [typeOptions],
  )
  const allTypeKeysSig = allTypeKeys.join(',')

  useEffect(() => {
    if (!planId) {
      filterHydratedPlanRef.current = ''
      setFilterTypeKeys([])
      setShowRoutes(true)
      setShowRouteTips(true)
      return
    }
    const pref = getPlanMapFilterPref(planId)
    setShowRoutes(pref.showRoutes)
    setShowRouteTips(pref.showRouteTips)
  }, [planId])

  useEffect(() => {
    if (!planId) {
      filterHydratedPlanRef.current = ''
      setFilterTypeKeys([])
      return
    }
    if (allTypeKeys.length === 0) {
      if (filterHydratedPlanRef.current !== planId) setFilterTypeKeys([])
      return
    }

    if (filterHydratedPlanRef.current !== planId) {
      filterHydratedPlanRef.current = planId
      setFilterTypeKeys(loadTypeFilterKeys(planId, allTypeKeys))
      return
    }

    setFilterTypeKeys((prev) => {
      const next = reconcileTypeFilterKeys(prev, allTypeKeys)
      if (!sameKeys(prev, next)) {
        void Promise.resolve().then(() => {
          if (planIdRef.current === planId) {
            setPlanTypeFilterKeys(planId, next, allTypeKeys)
          }
        })
      }
      return next
    })
    // allTypeKeys 由 allTypeKeysSig 代表；避免 places 刷新时引用变化误触发
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allTypeKeysSig
  }, [planId, allTypeKeysSig])

  const onFilterChange = useCallback((keys: string[]) => {
    setFilterTypeKeys(keys)
  }, [])

  const onShowRoutesChange = useCallback((next: boolean) => {
    setShowRoutes(next)
  }, [])

  const onShowRouteTipsChange = useCallback((next: boolean) => {
    setShowRouteTips(next)
  }, [])

  const filteredStops = useMemo(
    () =>
      filterStopsByPlaceType(stops, places, filterTypeKeys) as TripStop[],
    [stops, places, filterTypeKeys],
  )

  const refresh = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      setPlaces([])
      setStops([])
      return
    }
    setPlan(p)
    setPlaces(listAllPlacesByPlan(id))
    setStops(listStopsByPlan(id))
    Taro.setNavigationBarTitle({ title: '行程编辑' })
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
    setPlanId(id)
    refresh(id)
    void preloadNumberedDotMarkers()
  })

  useDidShow(() => {
    if (planId) refresh(planId)
  })

  const toggleFilter = useCallback(() => {
    setFilterOpen((v) => !v)
  }, [])

  const closeFilter = useCallback(() => setFilterOpen(false), [])

  if (!plan) {
    return (
      <View className='detail detail--map'>
        <View className='empty'>计划不存在或已删除</View>
      </View>
    )
  }

  return (
    <View className='detail detail--map'>
      <TripMapView
        plan={plan}
        places={places}
        stops={filteredStops}
        showRoutes={showRoutes}
        showRouteTips={showRouteTips}
        onTripChanged={() => {
          if (!planId) return
          setPlaces(listAllPlacesByPlan(planId))
          setStops(listStopsByPlan(planId))
          refreshPlanMeta(planId)
        }}
        onRemoveStop={(stopId) => {
          deleteStop(stopId)
          if (!planId) return
          setStops(listStopsByPlan(planId))
          refreshPlanMeta(planId)
          Taro.showToast({ title: '已移除', icon: 'success' })
        }}
        onReorderGroups={(groups) => {
          if (!planId) return
          try {
            setStops(
              reorderPlanStops(
                planId,
                groups.map((g) => ({
                  dayIndex: Number(g.id),
                  stopIds: g.items.map((it) => it.id),
                })),
              ),
            )
            refreshPlanMeta(planId)
          } catch (err) {
            const msg = err instanceof Error ? err.message : '排序失败'
            Taro.showToast({ title: msg, icon: 'none' })
          }
        }}
      />
      <TypeFilter
        planId={planId}
        options={typeOptions}
        selectedKeys={filterTypeKeys}
        showRoutes={showRoutes}
        showRouteTips={showRouteTips}
        open={filterOpen}
        onToggle={toggleFilter}
        onClose={closeFilter}
        onChange={onFilterChange}
        onShowRoutesChange={onShowRoutesChange}
        onShowRouteTipsChange={onShowRouteTipsChange}
      />
    </View>
  )
}

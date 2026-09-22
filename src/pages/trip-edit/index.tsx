import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import {
  deleteStop,
  getPlan,
  listAllPlacesByPlan,
  listStopsByPlan,
  reorderPlanStops,
} from '../../services/storage'
import {
  TripMapView,
  TypeFilter,
  collectPlaceTypeOptions,
  filterStopsByPlaceType,
  placeTypeFilterKey,
} from '../../features/trip'
import './index.scss'

export default function TripEditPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [stops, setStops] = useState<TripStop[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTypeKeys, setFilterTypeKeys] = useState<string[]>([])

  const typeOptions = useMemo(() => collectPlaceTypeOptions(places), [places])
  const allTypeKeys = useMemo(
    () => typeOptions.map((o) => placeTypeFilterKey(o)),
    [typeOptions],
  )
  const allTypeKeysSig = allTypeKeys.join(',')

  useEffect(() => {
    setFilterTypeKeys((prev) => {
      if (allTypeKeys.length === 0) return []
      if (prev.length === 0) return allTypeKeys
      const keySet = new Set(allTypeKeys)
      const kept = prev.filter((k) => keySet.has(k))
      const missing = allTypeKeys.filter((k) => !kept.includes(k))
      const hadAllExisting =
        missing.length + kept.length === allTypeKeys.length &&
        allTypeKeys
          .filter((k) => !missing.includes(k))
          .every((k) => kept.includes(k))
      if (hadAllExisting) return allTypeKeys
      if (kept.length === 0) return allTypeKeys
      return kept
    })
  }, [allTypeKeysSig, allTypeKeys])

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
        options={typeOptions}
        selectedKeys={filterTypeKeys}
        open={filterOpen}
        onToggle={toggleFilter}
        onClose={closeFilter}
        onChange={setFilterTypeKeys}
      />
    </View>
  )
}

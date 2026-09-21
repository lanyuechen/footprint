import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import {
  deleteStop,
  getPlan,
  getLastPlanView,
  listPlacesByPlan,
  listStopsByPlan,
  reorderPlanStops,
  setLastPlanView,
  setPlanDayCount,
  updatePlaceInfo,
  updateStopExpectedAt,
} from '../../services/storage'
import { TimelineView } from './TimelineView'
import { TripMapView } from './TripMapView'
import { TypeFilter } from './TypeFilter'
import { ViewSwitch } from './ViewSwitch'
import {
  collectPlaceTypeOptions,
  filterStopsByPlaceType,
  placeTypeFilterKey,
} from './place-type-filter'
import type { PlanView } from './types'
import './index.scss'

export default function PlanViewPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [stops, setStops] = useState<TripStop[]>([])
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTypeKeys, setFilterTypeKeys] = useState<string[]>([])
  const [planView, setPlanView] = useState<PlanView>(getLastPlanView)

  const typeOptions = useMemo(() => collectPlaceTypeOptions(places), [places])
  const allTypeKeys = useMemo(
    () => typeOptions.map((o) => placeTypeFilterKey(o)),
    [typeOptions],
  )
  const allTypeKeysSig = allTypeKeys.join(',')

  /** 默认全选；类型增减时：仍全选则跟全新列表，否则保留交集（空则回退全选） */
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
    setPlaces(listPlacesByPlan(id))
    setStops(listStopsByPlan(id))
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

  const selectPlanView = (next: PlanView) => {
    setViewMenuOpen(false)
    setFilterOpen(false)
    if (next === planView) return
    setLastPlanView(next)
    setPlanView(next)
  }

  const toggleViewMenu = useCallback(() => {
    setFilterOpen(false)
    setViewMenuOpen((v) => !v)
  }, [])

  const closeViewMenu = useCallback(() => setViewMenuOpen(false), [])

  const toggleFilter = useCallback(() => {
    setViewMenuOpen(false)
    setFilterOpen((v) => !v)
  }, [])

  const closeFilter = useCallback(() => setFilterOpen(false), [])

  if (!plan) {
    return (
      <View className='detail'>
        <View className='empty'>计划不存在或已删除</View>
      </View>
    )
  }

  return (
    <View
      className={`detail ${
        planView === 'map' ? 'detail--map' : 'detail--timeline'
      }`}
    >
      {planView === 'map' ? (
        <TripMapView
          plan={plan}
          places={places}
          stops={filteredStops}
          onReorderGroups={(groups) => {
            if (!planId) return
            try {
              setStops(
                reorderPlanStops(
                  planId,
                  groups.map((g) => ({
                    datePart: g.id,
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
      ) : (
        <TimelineView
          plan={plan}
          places={places}
          stops={filteredStops}
          onRemoveStop={(stopId) => {
            deleteStop(stopId)
            if (!planId) return
            setStops(listStopsByPlan(planId))
            refreshPlanMeta(planId)
            Taro.showToast({ title: '已移除', icon: 'success' })
          }}
          onReschedule={(stopId, expectedAt) => {
            const updated = updateStopExpectedAt(stopId, expectedAt)
            if (!updated || !planId) {
              Taro.showToast({ title: '时间未保存', icon: 'none' })
              return
            }
            setStops(listStopsByPlan(planId))
            refreshPlanMeta(planId)
          }}
          onUpdatePlace={(placeId, input) => {
            const updated = updatePlaceInfo(placeId, input)
            if (!updated || !planId) {
              Taro.showToast({ title: '保存失败', icon: 'none' })
              return
            }
            setPlaces(listPlacesByPlan(planId))
            refreshPlanMeta(planId)
          }}
          onReorderGroups={(groups) => {
            if (!planId) return
            try {
              setStops(
                reorderPlanStops(
                  planId,
                  groups.map((g) => ({
                    datePart: g.id,
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
          onAddDay={() => {
            if (!planId || !plan) return
            const next = setPlanDayCount(planId, (plan.dayCount || 1) + 1)
            if (next) setPlan(next)
          }}
        />
      )}
      <ViewSwitch
        planView={planView}
        open={viewMenuOpen}
        onToggle={toggleViewMenu}
        onClose={closeViewMenu}
        onSelect={selectPlanView}
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

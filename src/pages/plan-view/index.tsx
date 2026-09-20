import { useDidShow, useLoad } from '@tarojs/taro'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import {
  addStopsToDay,
  deleteStop,
  getPlan,
  getLastPlanView,
  listPlacesByPlan,
  listStopsByPlan,
  reorderPlanStops,
  setLastPlanView,
  setPlanDayCount,
  updateStopExpectedAt,
} from '../../services/storage'
import { TimelineView } from './TimelineView'
import { TripMapView } from './TripMapView'
import { ViewSwitch } from './ViewSwitch'
import type { PlanView } from './types'
import './index.scss'

export default function PlanViewPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [stops, setStops] = useState<TripStop[]>([])
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [planView, setPlanView] = useState<PlanView>(getLastPlanView)

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
    if (next === planView) return
    setLastPlanView(next)
    setPlanView(next)
  }

  const goAddPlace = () => {
    if (!planId) return
    Taro.navigateTo({ url: `/pages/place-add/index?id=${planId}` })
  }

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
        <TripMapView plan={plan} places={places} stops={stops} />
      ) : (
        <TimelineView
          plan={plan}
          places={places}
          stops={stops}
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
          onAddStops={(datePart, placeIds) => {
            if (!planId) return
            try {
              const created = addStopsToDay({ planId, datePart, placeIds })
              setStops(listStopsByPlan(planId))
              const p = getPlan(planId)
              if (p) setPlan(p)
              Taro.showToast({
                title:
                  created.length > 0 ? `已添加 ${created.length} 个` : '未添加',
                icon: created.length > 0 ? 'success' : 'none',
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : '添加失败'
              Taro.showToast({ title: msg, icon: 'none' })
            }
          }}
          onAddDay={() => {
            if (!planId || !plan) return
            const next = setPlanDayCount(planId, (plan.dayCount || 1) + 1)
            if (next) setPlan(next)
          }}
          onAddPlace={goAddPlace}
        />
      )}
      <ViewSwitch
        planView={planView}
        open={viewMenuOpen}
        onToggle={() => setViewMenuOpen((open) => !open)}
        onClose={() => setViewMenuOpen(false)}
        onSelect={selectPlanView}
      />
    </View>
  )
}

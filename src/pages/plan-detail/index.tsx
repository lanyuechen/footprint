import { useDidShow, useLoad } from '@tarojs/taro'
import { View, Text, Map } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useMemo, useState } from 'react'
import type { TargetPoint, TravelPlan } from '../../types'
import { deletePoint, getPlan, listPointsByPlan } from '../../services/storage'
import { formatDateTime } from '../../utils/datetime'
import './index.scss'

type ViewMode = 'list' | 'map'

export default function PlanDetailPage() {
  const [planId, setPlanId] = useState('')
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [points, setPoints] = useState<TargetPoint[]>([])
  const [mode, setMode] = useState<ViewMode>('list')

  const refresh = (id: string) => {
    const p = getPlan(id)
    if (!p) {
      setPlan(null)
      setPoints([])
      return
    }
    setPlan(p)
    setPoints(listPointsByPlan(id))
  }

  useLoad((options) => {
    const id = options?.id || ''
    setPlanId(id)
    refresh(id)
  })

  useDidShow(() => {
    if (planId) refresh(planId)
  })

  const markers = useMemo(
    () =>
      points.map((p, i) => ({
        id: i + 1,
        latitude: p.place.latitude,
        longitude: p.place.longitude,
        title: p.place.name,
        width: 24,
        height: 34,
        callout: {
          content: `${i + 1}. ${p.place.name}\n${formatDateTime(p.expectedAt)}`,
          display: 'BYCLICK' as const,
          padding: 8,
          borderRadius: 6,
          fontSize: 12,
        },
      })),
    [points],
  )

  const mapCenter = useMemo(() => {
    if (points.length === 0) {
      return { latitude: 39.908823, longitude: 116.39747 }
    }
    const lat =
      points.reduce((sum, p) => sum + p.place.latitude, 0) / points.length
    const lng =
      points.reduce((sum, p) => sum + p.place.longitude, 0) / points.length
    return { latitude: lat, longitude: lng }
  }, [points])

  const includePoints = useMemo(
    () =>
      points.map((p) => ({
        latitude: p.place.latitude,
        longitude: p.place.longitude,
      })),
    [points],
  )

  const goAddPoint = () => {
    Taro.navigateTo({ url: `/pages/point-edit/index?planId=${planId}` })
  }

  const goEditPoint = (pointId: string) => {
    Taro.navigateTo({
      url: `/pages/point-edit/index?planId=${planId}&pointId=${pointId}`,
    })
  }

  const onDeletePoint = async (point: TargetPoint) => {
    const { confirm } = await Taro.showModal({
      title: '移除目标点',
      content: `确定移除「${point.place.name}」？`,
      confirmColor: '#c45656',
    })
    if (!confirm) return
    deletePoint(point.id)
    Taro.showToast({ title: '已移除', icon: 'success' })
    refresh(planId)
  }

  if (!plan) {
    return (
      <View className='detail'>
        <View className='empty'>计划不存在或已删除</View>
      </View>
    )
  }

  return (
    <View className='detail'>
      <View className='summary'>
        <View className='summary__name'>{plan.name}</View>
        {!!plan.description && (
          <View className='summary__desc'>{plan.description}</View>
        )}
      </View>

      <View className='tabs'>
        <Text
          className={`tabs__item ${mode === 'list' ? 'tabs__item--active' : ''}`}
          onClick={() => setMode('list')}
        >
          列表
        </Text>
        <Text
          className={`tabs__item ${mode === 'map' ? 'tabs__item--active' : ''}`}
          onClick={() => setMode('map')}
        >
          地图
        </Text>
      </View>

      {mode === 'list' ? (
        <View className='list'>
          {points.length === 0 ? (
            <View className='empty'>暂无目标点，点击下方添加</View>
          ) : (
            points.map((point, index) => (
              <View key={point.id} className='point-item'>
                <Text className='point-item__index'>{index + 1}</Text>
                <View className='point-item__body'>
                  <View className='point-item__name'>{point.place.name}</View>
                  <View className='point-item__addr'>{point.place.address}</View>
                  <View className='point-item__time'>
                    预期前往 {formatDateTime(point.expectedAt)}
                  </View>
                  <View className='point-item__actions'>
                    <Text
                      className='point-item__action'
                      onClick={() => goEditPoint(point.id)}
                    >
                      编辑
                    </Text>
                    <Text
                      className='point-item__action point-item__action--danger'
                      onClick={() => onDeletePoint(point)}
                    >
                      移除
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      ) : (
        <View className='map-wrap'>
          {points.length === 0 ? (
            <View className='empty'>暂无目标点可展示</View>
          ) : (
            <Map
              className='map'
              latitude={mapCenter.latitude}
              longitude={mapCenter.longitude}
              scale={12}
              markers={markers}
              includePoints={includePoints}
              showLocation
            />
          )}
        </View>
      )}

      <View className='fab' onClick={goAddPoint}>
        添加目标点
      </View>
    </View>
  )
}

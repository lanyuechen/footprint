import { useDidShow } from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { TravelPlan } from '../../types'
import { deletePlan, listPlans } from '../../services/storage'
import { formatDateTime } from '../../utils/datetime'
import './index.scss'

export default function IndexPage() {
  const [plans, setPlans] = useState<TravelPlan[]>([])

  const refresh = () => {
    setPlans(listPlans())
  }

  useDidShow(() => {
    refresh()
  })

  const goCreate = () => {
    Taro.navigateTo({ url: '/pages/plan-edit/index' })
  }

  const goDetail = (id: string) => {
    Taro.navigateTo({ url: `/pages/plan-detail/index?id=${id}` })
  }

  const goEdit = (id: string) => {
    Taro.navigateTo({ url: `/pages/plan-edit/index?id=${id}` })
  }

  const onDelete = async (plan: TravelPlan) => {
    const { confirm } = await Taro.showModal({
      title: '删除计划',
      content: `确定删除「${plan.name}」？其下目标点将一并删除。`,
      confirmColor: '#c45656',
    })
    if (!confirm) return
    deletePlan(plan.id)
    Taro.showToast({ title: '已删除', icon: 'success' })
    refresh()
  }

  return (
    <View className='index'>
      <View className='header'>
        <Text className='header__title'>足迹规划</Text>
        <Text className='header__sub'>本地旅行计划，按时间安排去处</Text>
      </View>

      {plans.length === 0 ? (
        <View className='empty'>
          <Text className='empty__text'>还没有计划</Text>
          <Text className='empty__hint'>点击右下角创建第一个旅行计划</Text>
        </View>
      ) : (
        <View className='plan-list'>
          {plans.map((plan) => (
            <View key={plan.id} className='plan-item' onClick={() => goDetail(plan.id)}>
              <View className='plan-item__name'>{plan.name}</View>
              {!!plan.description && (
                <View className='plan-item__desc'>{plan.description}</View>
              )}
              <View className='plan-item__meta'>
                {plan.pointIds.length} 个目标点 · 更新于 {formatDateTime(plan.updatedAt)}
              </View>
              <View
                className='plan-item__actions'
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <Text
                  className='plan-item__action'
                  onClick={() => goEdit(plan.id)}
                >
                  编辑
                </Text>
                <Text
                  className='plan-item__action plan-item__action--danger'
                  onClick={() => onDelete(plan)}
                >
                  删除
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View className='fab' onClick={goCreate}>
        +
      </View>
    </View>
  )
}

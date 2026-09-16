import { useDidShow } from '@tarojs/taro'
import { MovableArea, MovableView, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { TravelPlan } from '../../types'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import { deletePlan, listPlans, listPointsByPlan } from '../../services/storage'
import { formatPlanSummary, spanDays } from '../../utils/datetime'
import './index.scss'

/** 编辑 + 删除按钮总宽，与样式一致（设计稿 px） */
const ACTION_WIDTH = 280

function PlanMeta({ plan }: { plan: TravelPlan }) {
  const places = listPointsByPlan(plan.id)
  return (
    <>
      <View className='plan-item__name'>{plan.name}</View>
      {!!plan.description && <View className='plan-item__desc'>{plan.description}</View>}
      <View className='plan-item__meta'>
        {formatPlanSummary(places.length, spanDays(places.map((point) => point.expectedAt)))}
      </View>
    </>
  )
}

function PlanSwipeRow({
  plan,
  opened,
  onOpen,
  onClose,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  plan: TravelPlan
  opened: boolean
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onOpenDetail: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (plan: TravelPlan) => void
}) {
  const [x, setX] = useState(0)
  const [animate, setAnimate] = useState(true)
  const xRef = useRef(0)
  const widthRef = useRef(140)
  const movedRef = useRef(false)
  const actionTouchRef = useRef(false)

  useEffect(() => {
    const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
    widthRef.current = (info.windowWidth / 750) * ACTION_WIDTH
    Taro.nextTick(() => {
      const page = Taro.getCurrentInstance().page
      const query = page ? Taro.createSelectorQuery().in(page) : Taro.createSelectorQuery()
      query
        .select(`#plan-actions-${plan.id}`)
        .boundingClientRect()
        .exec((res) => {
          const width = res?.[0]?.width
          if (width) widthRef.current = width
        })
    })
  }, [plan.id])

  useEffect(() => {
    if (opened || Math.abs(xRef.current) < 1) return
    const current = xRef.current
    setAnimate(false)
    setX(current)
    Taro.nextTick(() => {
      setAnimate(true)
      setX(0)
      xRef.current = 0
    })
  }, [opened])

  const snap = (open: boolean) => {
    const next = open ? -widthRef.current : 0
    const current = xRef.current
    setAnimate(false)
    setX(current)
    Taro.nextTick(() => {
      setAnimate(true)
      setX(next)
      xRef.current = next
      if (open) onOpen(plan.id)
      else onClose(plan.id)
    })
  }

  return (
    <View className='plan-swipe'>
      <View className='plan-swipe__sizer'>
        <PlanMeta plan={plan} />
      </View>
      <MovableArea className='plan-swipe__area' style={{ width: '100%', height: '100%' }}>
        <MovableView
          className='plan-swipe__mover'
          style={{ width: 'calc(100% + 280rpx)', height: '100%' }}
          direction='horizontal'
          x={x}
          damping={40}
          friction={2}
          animation={animate}
          outOfBounds={false}
          onTouchStart={() => {
            if (!opened) onClose(plan.id)
          }}
          onChange={(e) => {
            if (actionTouchRef.current) return
            const next = e.detail.x
            xRef.current = next
            if (e.detail.source === 'touch' && Math.abs(next) > 6) movedRef.current = true
          }}
          onTouchEnd={() => {
            if (actionTouchRef.current) {
              actionTouchRef.current = false
              return
            }
            snap(xRef.current < -widthRef.current / 2)
          }}
        >
          <View
            className='plan-item'
            onClick={(e) => {
              e.stopPropagation()
              if (movedRef.current) {
                movedRef.current = false
                return
              }
              if (opened || xRef.current < -8) {
                snap(false)
                return
              }
              onOpenDetail(plan.id)
            }}
          >
            <PlanMeta plan={plan} />
          </View>
          <View id={`plan-actions-${plan.id}`} className='plan-swipe__actions'>
            <View
              className='plan-swipe__btn plan-swipe__btn--edit'
              catchMove
              onTouchStart={() => {
                actionTouchRef.current = true
              }}
              onClick={(e) => {
                e.stopPropagation()
                onEdit(plan.id)
              }}
            >
              <SquarePen size={22} color='#fff' />
            </View>
            <View
              className='plan-swipe__btn plan-swipe__btn--delete'
              catchMove
              onTouchStart={() => {
                actionTouchRef.current = true
              }}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(plan)
              }}
            >
              <Trash2 size={22} color='#fff' />
            </View>
          </View>
        </MovableView>
      </MovableArea>
    </View>
  )
}

export default function IndexPage() {
  const [plans, setPlans] = useState<TravelPlan[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

  const refresh = () => {
    setPlans(listPlans())
  }

  useDidShow(() => {
    setOpenId(null)
    refresh()
  })

  const goCreate = () => {
    Taro.navigateTo({ url: '/pages/plan-edit/index' })
  }

  const goDetail = (id: string) => {
    Taro.navigateTo({ url: `/pages/plan-view/index?id=${id}` })
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
    <View className='index' onClick={() => setOpenId(null)}>
      <View className='header'>
        <Text className='header__title'>我的计划</Text>
      </View>

      {plans.length === 0 ? (
        <View className='empty'>
          <Text className='empty__text'>还没有计划</Text>
          <Text className='empty__hint'>点击下方添加第一个旅行计划</Text>
        </View>
      ) : (
        <View className='plan-list'>
          {plans.map((plan) => (
            <PlanSwipeRow
              key={plan.id}
              plan={plan}
              opened={openId === plan.id}
              onOpen={setOpenId}
              onClose={() => setOpenId(null)}
              onOpenDetail={goDetail}
              onEdit={goEdit}
              onDelete={onDelete}
            />
          ))}
        </View>
      )}

      <View className='add-plan' onClick={goCreate}>
        <Text className='add-plan__text'>+ 添加计划</Text>
      </View>
    </View>
  )
}

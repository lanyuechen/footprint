import { useDidShow, useLoad } from '@tarojs/taro'
import { View, Text, Input, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import type { TravelPlan } from '../../types'
import { getPlan, listStopsByPlan, updatePlan } from '../../services/storage'
import { toDatePart } from '../../utils/datetime'
import { useDropdownAnim } from '../../hooks/useDropdownAnim'
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight'
import { SimpleMarkdown } from '../../components/SimpleMarkdown'
import './index.scss'

function formatPlanStartDate(startDate: string): string {
  const raw = startDate.trim()
  if (!raw) return ''
  const [y, m, d] = raw.split('-').map(Number)
  if (!y || !m || !d) return raw
  return `${y}年${m}月${d}日`
}

function PlanNameEditSheet({
  open,
  plan,
  onClose,
  onSaved,
}: {
  open: boolean
  plan: TravelPlan | null
  onClose: () => void
  onSaved: () => void
}) {
  const { mounted, shown } = useDropdownAnim(open)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [inputFocus, setInputFocus] = useState(false)
  const keyboardHeight = useKeyboardHeight(open && shown)

  useEffect(() => {
    if (open && plan) {
      setDraft(plan.name || '')
      setSaving(false)
    }
    if (!open) {
      setDraft('')
      setSaving(false)
      setInputFocus(false)
    }
  }, [open, plan])

  useEffect(() => {
    if (!shown) {
      setInputFocus(false)
      return
    }
    const timer = setTimeout(() => setInputFocus(true), 300)
    return () => clearTimeout(timer)
  }, [shown])

  if (!mounted || !plan) return null

  const save = () => {
    if (saving) return
    const next = draft.trim()
    if (!next) {
      Taro.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    const prev = plan.name?.trim() || ''
    if (next === prev) {
      onClose()
      return
    }
    setSaving(true)
    const updated = updatePlan(plan.id, {
      name: next,
      description: plan.description || '',
      startDate: plan.startDate,
    })
    setSaving(false)
    if (!updated) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    onSaved()
  }

  return (
    <View
      className={`plan-quick-edit${shown ? ' plan-quick-edit--open' : ''}`}
      catchMove
    >
      <View className='plan-quick-edit__mask' onClick={onClose} />
      <View
        className='plan-quick-edit__panel'
        style={{
          bottom: keyboardHeight,
          paddingBottom: keyboardHeight > 0 ? 8 : undefined,
        }}
      >
        <View className='plan-quick-edit__head'>
          <Text className='plan-quick-edit__title'>名称</Text>
          <Text className='plan-quick-edit__close' onClick={onClose}>
            关闭
          </Text>
        </View>
        <View className='plan-quick-edit__body'>
          <Input
            className='plan-quick-edit__input'
            value={draft}
            placeholder='计划名称'
            maxlength={40}
            focus={inputFocus}
            adjustPosition={false}
            holdKeyboard
            confirmType='done'
            onInput={(e) => setDraft(e.detail.value)}
            onConfirm={save}
          />
        </View>
        <View className='plan-quick-edit__foot'>
          <View className='plan-quick-edit__btn' onClick={onClose}>
            取消
          </View>
          <View
            className={`plan-quick-edit__btn plan-quick-edit__btn--primary${
              saving ? ' plan-quick-edit__btn--disabled' : ''
            }`}
            onClick={save}
          >
            保存
          </View>
        </View>
      </View>
    </View>
  )
}

export default function PlanDetailPage() {
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [stopCount, setStopCount] = useState(0)
  const [nameEditOpen, setNameEditOpen] = useState(false)

  const load = (id: string) => {
    const p = id ? getPlan(id) : undefined
    if (!p) {
      setPlan(null)
      setStopCount(0)
      return
    }
    setPlan(p)
    setStopCount(listStopsByPlan(p.id).length)
    Taro.setNavigationBarTitle({ title: '计划详情' })
  }

  useLoad((options) => {
    const id = options?.id || ''
    if (!id) {
      Taro.showToast({ title: '计划不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    load(id)
    if (!getPlan(id)) {
      Taro.showToast({ title: '计划不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
    }
  })

  useDidShow(() => {
    if (plan?.id) load(plan.id)
  })

  const goTripEdit = () => {
    if (!plan) return
    Taro.navigateTo({ url: `/pages/trip-edit/index?id=${plan.id}` })
  }

  const onPickStartDate = (next: string) => {
    if (!plan || !next || next === plan.startDate) return
    const updated = updatePlan(plan.id, {
      name: plan.name || '',
      description: plan.description || '',
      startDate: next,
    })
    if (!updated) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    load(plan.id)
  }

  if (!plan) {
    return (
      <View className='plan-detail'>
        <View className='plan-detail__empty'>计划不存在或已删除</View>
      </View>
    )
  }

  const timeLabel = formatPlanStartDate(plan.startDate || '')
  const days = Math.max(1, plan.dayCount || 1)
  const desc = plan.description?.trim() || ''
  const dateValue = plan.startDate || toDatePart(new Date().toISOString())

  return (
    <View className='plan-detail'>
      <View className='plan-detail__glow' aria-hidden />

      <View className='plan-detail__hero'>
        <Text className='plan-detail__eyebrow'>旅行计划</Text>
        <Text
          className='plan-detail__name'
          onClick={() => setNameEditOpen(true)}
        >
          {plan.name || '未命名计划'}
        </Text>
        <Picker
          mode='date'
          value={dateValue}
          onChange={(e) => onPickStartDate(e.detail.value)}
        >
          <Text className='plan-detail__date'>
            {timeLabel || '选择开始日期'}
          </Text>
        </Picker>
      </View>

      <View className='plan-detail__metrics'>
        <View className='plan-detail__metric'>
          <Text className='plan-detail__metric-value'>{days}</Text>
          <Text className='plan-detail__metric-label'>天</Text>
        </View>
        <View className='plan-detail__metric-rule' />
        <View
          className='plan-detail__metric plan-detail__metric--link'
          onClick={goTripEdit}
        >
          <Text className='plan-detail__metric-value'>{stopCount}</Text>
          <Text className='plan-detail__metric-label'>行程</Text>
        </View>
      </View>

      <View className='plan-detail__section'>
        {desc ? (
          <SimpleMarkdown source={desc} className='plan-detail__md' />
        ) : (
          <Text className='plan-detail__desc plan-detail__desc--empty'>
            还没有写描述
          </Text>
        )}
      </View>

      <PlanNameEditSheet
        open={nameEditOpen}
        plan={plan}
        onClose={() => setNameEditOpen(false)}
        onSaved={() => {
          setNameEditOpen(false)
          if (plan.id) load(plan.id)
        }}
      />
    </View>
  )
}

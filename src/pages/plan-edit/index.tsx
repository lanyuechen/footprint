import { useLoad } from '@tarojs/taro'
import { View, Text, Input, Textarea, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { createPlan, getPlan, updatePlan } from '../../services/storage'
import { toDatePart } from '../../utils/datetime'
import './index.scss'

export default function PlanEditPage() {
  const [planId, setPlanId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState(toDatePart(new Date().toISOString()))
  const isEdit = !!planId

  useLoad((options) => {
    const id = options?.id || ''
    if (id) {
      const plan = getPlan(id)
      if (!plan) {
        Taro.showToast({ title: '计划不存在', icon: 'none' })
        setTimeout(() => Taro.navigateBack(), 800)
        return
      }
      setPlanId(plan.id)
      setName(plan.name)
      setDescription(plan.description)
      setStartDate(plan.startDate || toDatePart(plan.createdAt))
      Taro.setNavigationBarTitle({ title: '编辑计划' })
    } else {
      Taro.setNavigationBarTitle({ title: '新建计划' })
    }
  })

  const onSave = () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请输入计划名称', icon: 'none' })
      return
    }
    if (!startDate) {
      Taro.showToast({ title: '请选择开始日期', icon: 'none' })
      return
    }
    if (isEdit) {
      updatePlan(planId, { name, description, startDate })
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 500)
    } else {
      createPlan({ name, description, startDate })
      Taro.showToast({ title: '已创建', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 500)
    }
  }

  return (
    <View className='plan-edit'>
      <View className='field'>
        <Text className='field__label'>名称</Text>
        <View className='field__input-wrap'>
          <Input
            className='field__input'
            value={name}
            maxlength={40}
            placeholder='例如：周末杭州两日'
            onInput={(e) => setName(e.detail.value)}
          />
        </View>
      </View>
      <View className='field'>
        <Text className='field__label'>开始日期</Text>
        <Picker
          mode='date'
          value={startDate}
          onChange={(e) => setStartDate(e.detail.value)}
        >
          <View className='field__input-wrap field__picker'>
            <Text className='field__picker-text'>{startDate}</Text>
          </View>
        </Picker>
        <Text className='field__hint'>时间轴将以此日为起点</Text>
      </View>
      <View className='field'>
        <Text className='field__label'>描述</Text>
        <Textarea
          className='field__textarea'
          value={description}
          maxlength={200}
          placeholder='可选，补充计划说明'
          onInput={(e) => setDescription(e.detail.value)}
        />
      </View>
      <View className='actions'>
        <View className='btn btn--primary' onClick={onSave}>
          保存
        </View>
        <View className='btn btn--ghost' onClick={() => Taro.navigateBack()}>
          取消
        </View>
      </View>
    </View>
  )
}

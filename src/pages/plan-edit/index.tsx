import { useLoad } from '@tarojs/taro'
import { View, Text, Input, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { createPlan, getPlan, updatePlan } from '../../services/storage'
import './index.scss'

export default function PlanEditPage() {
  const [planId, setPlanId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
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
    if (isEdit) {
      updatePlan(planId, { name, description })
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 500)
    } else {
      const plan = createPlan({ name, description })
      Taro.showToast({ title: '已创建', icon: 'success' })
      setTimeout(() => {
        Taro.redirectTo({ url: `/pages/plan-view/index?id=${plan.id}` })
      }, 500)
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

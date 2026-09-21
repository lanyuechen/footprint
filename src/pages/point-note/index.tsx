import { useLoad } from '@tarojs/taro'
import { View, Text, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { getStop, resolveStopPlace, updateStopNote } from '../../services/storage'
import './index.scss'

export default function PointNotePage() {
  const [stopId, setStopId] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [note, setNote] = useState('')
  const [editorHeight, setEditorHeight] = useState(480)
  const [saving, setSaving] = useState(false)

  useLoad((options) => {
    const id = options?.stopId || options?.pointId || ''
    const stop = getStop(id)
    if (!stop) {
      Taro.showToast({ title: '行程不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    const place = resolveStopPlace(stop)
    setStopId(stop.id)
    setPlaceName(place?.place.name || '行程备注')
    setNote(stop.note || '')
    Taro.setNavigationBarTitle({
      title: place?.place.name || '编辑备注',
    })

    const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
    setEditorHeight(Math.max((info.windowHeight || 667) - 260, 240))
  })

  const onSave = () => {
    if (!stopId || saving) return
    setSaving(true)
    const updated = updateStopNote(stopId, { note })
    setSaving(false)
    if (!updated) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    Taro.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => Taro.navigateBack(), 400)
  }

  return (
    <View className='point-note'>
      <View className='point-note__head'>
        <Text className='point-note__label'>备注</Text>
        <Text className='point-note__name'>{placeName}</Text>
      </View>
      <Textarea
        className='point-note__editor'
        style={{ height: `${editorHeight}px` }}
        value={note}
        maxlength={2000}
        placeholder='写下开放时间、门票、怎么走等备注'
        onInput={(e) => setNote(e.detail.value)}
      />
      <View className='point-note__foot'>
        <View
          className={`point-note__save${saving ? ' point-note__save--disabled' : ''}`}
          onClick={onSave}
        >
          {saving ? '保存中…' : '保存'}
        </View>
      </View>
    </View>
  )
}

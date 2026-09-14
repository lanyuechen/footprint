import { useLoad } from '@tarojs/taro'
import { View, Text, Editor, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import { getPoint, updatePointNote } from '../../services/storage'
import { combineDateTime, toDatePart, toTimePart } from '../../utils/datetime'
import './index.scss'

const EDITOR_ID = 'point-note-editor'

type NoteEditorContext = {
  setContents: (opt: { html?: string }) => void
  getContents: (opt: {
    success?: (res: { html?: string; text?: string }) => void
    fail?: () => void
  }) => void
}

export default function PointNotePage() {
  const [pointId, setPointId] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [datePart, setDatePart] = useState('')
  const [timePart, setTimePart] = useState('')
  const [editorHeight, setEditorHeight] = useState(480)
  const [saving, setSaving] = useState(false)
  const noteHtmlRef = useRef('')
  const editorCtxRef = useRef<NoteEditorContext | null>(null)

  useLoad((options) => {
    const id = options?.pointId || ''
    const point = getPoint(id)
    if (!point) {
      Taro.showToast({ title: '地点不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    setPointId(point.id)
    setPlaceName(point.place.name)
    setDatePart(toDatePart(point.expectedAt))
    setTimePart(toTimePart(point.expectedAt))
    noteHtmlRef.current = point.noteHtml || ''
    Taro.setNavigationBarTitle({ title: point.place.name || '编辑地点' })

    const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
    // 地点名、时间选择、底部保存栏
    setEditorHeight(Math.max((info.windowHeight || 667) - 340, 240))
  })

  const onEditorReady = () => {
    const page = Taro.getCurrentInstance().page
    const query = Taro.createSelectorQuery()
    if (page) query.in(page)
    query
      .select(`#${EDITOR_ID}`)
      .context((res) => {
        const ctx = (res as { context?: NoteEditorContext }).context
        if (!ctx) return
        editorCtxRef.current = ctx
        if (noteHtmlRef.current) {
          ctx.setContents({ html: noteHtmlRef.current })
        }
      })
      .exec()
  }

  const onSave = () => {
    if (!pointId || saving) return
    const ctx = editorCtxRef.current
    if (!ctx) {
      Taro.showToast({ title: '编辑器未就绪', icon: 'none' })
      return
    }
    setSaving(true)
    ctx.getContents({
      success: (res) => {
        const html = res.html || ''
        const text = (res.text || '').replace(/\u00a0/g, ' ').trim()
        const updated = updatePointNote(pointId, {
          noteHtml: text ? html : '',
          noteText: text,
          expectedAt: combineDateTime(datePart, timePart),
        })
        setSaving(false)
        if (!updated) {
          Taro.showToast({ title: '保存失败', icon: 'none' })
          return
        }
        Taro.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => Taro.navigateBack(), 400)
      },
      fail: () => {
        setSaving(false)
        Taro.showToast({ title: '读取内容失败', icon: 'none' })
      },
    })
  }

  return (
    <View className='point-note'>
      <View className='point-note__head'>
        <Text className='point-note__label'>备注</Text>
        <Text className='point-note__name'>{placeName}</Text>
      </View>
      <View className='point-note__time'>
        <Text className='point-note__label'>预期时间</Text>
        <View className='point-note__time-row'>
          <Picker mode='date' value={datePart} onChange={(e) => setDatePart(e.detail.value)}>
            <View className='point-note__time-value'>{datePart || '选择日期'}</View>
          </Picker>
          <Picker mode='time' value={timePart} onChange={(e) => setTimePart(e.detail.value)}>
            <View className='point-note__time-value'>{timePart || '选择时间'}</View>
          </Picker>
        </View>
      </View>
      <Editor
        id={EDITOR_ID}
        className='point-note__editor'
        style={{ height: `${editorHeight}px` }}
        placeholder='写下开放时间、门票、怎么走等备注'
        showImgSize={false}
        showImgToolbar={false}
        showImgResize={false}
        onReady={onEditorReady}
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

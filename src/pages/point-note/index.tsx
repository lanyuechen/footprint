import { useLoad } from '@tarojs/taro'
import { View, Text, Editor } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import { getPlace, updatePlaceNote } from '../../services/storage'
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
  const [placeId, setPlaceId] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [editorHeight, setEditorHeight] = useState(480)
  const [saving, setSaving] = useState(false)
  const noteHtmlRef = useRef('')
  const editorCtxRef = useRef<NoteEditorContext | null>(null)

  useLoad((options) => {
    const id = options?.pointId || options?.placeId || ''
    const place = getPlace(id)
    if (!place) {
      Taro.showToast({ title: '地点不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    setPlaceId(place.id)
    setPlaceName(place.place.name)
    noteHtmlRef.current = place.noteHtml || ''
    Taro.setNavigationBarTitle({ title: place.place.name || '编辑地点' })

    const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
    setEditorHeight(Math.max((info.windowHeight || 667) - 260, 240))
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
    if (!placeId || saving) return
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
        const updated = updatePlaceNote(placeId, {
          noteHtml: text ? html : '',
          noteText: text,
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

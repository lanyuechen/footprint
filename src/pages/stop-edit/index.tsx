import { useLoad, getCurrentInstance } from '@tarojs/taro'
import { View, Text, Input, Textarea, Picker, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useMemo, useState } from 'react'
import type { NavMode, TravelPlan, TripStop } from '../../types'
import {
  getPlace,
  getPlan,
  getStop,
  updatePlaceInfo,
  updateStopSchedule,
} from '../../services/storage'
import { datePartOfDay, dayIndexOfDate } from '../../utils/datetime'
import {
  PLACE_TYPE_OPTIONS,
  lightenColor,
  matchPlaceTypeOption,
  type PlaceTypeOption,
} from '../../features/trip/place-axis'
import {
  KEY_NODE_TRAVEL_MODES,
  navModeMeta,
  normalizeNavMode,
} from '../../features/trip/nav-mode'
import { useDropdownAnim } from '../../hooks/useDropdownAnim'
import './index.scss'

type Draft = {
  name: string
  note: string
  dayIndex: number
  time: string
  typeOption: PlaceTypeOption
  isKeyNode: boolean
  travelMode: NavMode
}

function buildDraft(stop: TripStop, placeName: string): Draft {
  const collected = getPlace(stop.placeId)
  const place = collected?.place
  return {
    name: placeName || place?.name || '',
    note: stop.note || '',
    dayIndex: stop.dayIndex,
    time: stop.time?.trim() || '',
    typeOption: matchPlaceTypeOption(
      place || {
        name: placeName || '未知地点',
        address: '',
        latitude: 0,
        longitude: 0,
      },
    ),
    isKeyNode: !!stop.isKeyNode,
    travelMode: normalizeNavMode(stop.travelMode) || 'walking',
  }
}

/** 按面板宽度定列数，使「图标+标题」单元格接近正方形 */
function dropdownColumnCount(panelWidthPx: number): number {
  const ideal = 76
  return Math.max(3, Math.min(6, Math.round(panelWidthPx / ideal)))
}

export default function StopEditPage() {
  const [plan, setPlan] = useState<TravelPlan | null>(null)
  const [stop, setStop] = useState<TripStop | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [typeOpen, setTypeOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{
    top: number
    left: number
    width: number
    cols: number
  } | null>(null)
  const typeAnim = useDropdownAnim(typeOpen)
  const modeAnim = useDropdownAnim(modeOpen)

  const closeDropdowns = () => {
    setTypeOpen(false)
    setModeOpen(false)
  }

  const measureAndOpen = (fieldId: string, kind: 'type' | 'mode') => {
    const query = Taro.createSelectorQuery()
    query.select(`#${fieldId}`).boundingClientRect()
    query.exec((res) => {
      const rect = res?.[0] as
        | { top?: number; bottom?: number; left?: number; width?: number }
        | undefined
      if (
        rect &&
        typeof rect.bottom === 'number' &&
        typeof rect.left === 'number' &&
        typeof rect.width === 'number'
      ) {
        setDropdownPos({
          top: rect.bottom + 6,
          left: rect.left,
          width: rect.width,
          cols: dropdownColumnCount(rect.width),
        })
      } else {
        const win =
          Taro.getWindowInfo?.().windowWidth ||
          Taro.getSystemInfoSync().windowWidth ||
          375
        setDropdownPos({
          top: 120,
          left: 16,
          width: Math.max(win - 32, 200),
          cols: dropdownColumnCount(Math.max(win - 32, 200)),
        })
      }
      if (kind === 'type') {
        setModeOpen(false)
        setTypeOpen(true)
      } else {
        setTypeOpen(false)
        setModeOpen(true)
      }
    })
  }

  const openTypeDropdown = () => measureAndOpen('stop-edit-type-field', 'type')
  const openModeDropdown = () => measureAndOpen('stop-edit-mode-field', 'mode')

  useLoad((options) => {
    const planId = options?.planId || ''
    const stopId = options?.stopId || ''
    const p = planId ? getPlan(planId) : undefined
    const s = stopId ? getStop(stopId) : undefined
    if (!p || !s || s.planId !== p.id) {
      Taro.showToast({ title: '行程不存在', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 800)
      return
    }
    const place = getPlace(s.placeId)
    setPlan(p)
    setStop(s)
    setDraft(buildDraft(s, place?.place.name || ''))
  })

  const dateValue = useMemo(() => {
    if (!plan || !draft) return ''
    return datePartOfDay(plan.startDate, draft.dayIndex)
  }, [draft, plan])

  const dateEnd = useMemo(() => {
    if (!plan) return ''
    return datePartOfDay(plan.startDate, Math.max(plan.dayCount - 1, 30))
  }, [plan])

  const dateLabel = useMemo(() => {
    if (!draft || !dateValue) return ''
    const [y, m, d] = dateValue.split('-').map(Number)
    if (!y || !m || !d) return dateValue
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      new Date(y, m - 1, d).getDay()
    ]
    return `${m}月${d}日 · ${week}`
  }, [dateValue, draft])

  const travelMeta = navModeMeta(draft?.travelMode)
  const TravelIcon = travelMeta.Icon

  const onSave = () => {
    if (!plan || !stop || !draft || saving) return
    const name = draft.name.trim()
    if (!name) {
      Taro.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const place = updatePlaceInfo(stop.placeId, {
        name,
        type: draft.typeOption.type,
        typecode: draft.typeOption.typecode,
      })
      if (!place) {
        Taro.showToast({ title: '保存名称失败', icon: 'none' })
        return
      }

      const updated = updateStopSchedule(stop.id, {
        dayIndex: draft.dayIndex,
        time: draft.time || null,
        note: draft.note.trim() || null,
        isKeyNode: draft.isKeyNode,
        travelMode: draft.isKeyNode ? draft.travelMode : null,
      })
      if (!updated) {
        Taro.showToast({ title: '保存行程失败', icon: 'none' })
        return
      }

      const channel = getCurrentInstance().page?.getOpenerEventChannel?.()
      channel?.emit('saved', {
        dayIndex: draft.dayIndex,
        stopId: stop.id,
      })

      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 400)
    } finally {
      setSaving(false)
    }
  }

  if (!plan || !stop || !draft) {
    return <View className='stop-edit' />
  }

  const typeMark = draft.typeOption.mark
  const TypeIcon = typeMark.icon

  return (
    <View className='stop-edit'>
      <ScrollView scrollY className='stop-edit__scroll' enhanced>
        <View className='card-edit'>
          <View className='card-edit__field'>
            <Text className='card-edit__label'>名称</Text>
            <Input
              className='card-edit__input'
              value={draft.name}
              maxlength={40}
              placeholder='地点名称'
              onInput={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, name: e.detail.value } : prev,
                )
              }
            />
          </View>

          <View className='card-edit__field' id='stop-edit-type-field'>
            <Text className='card-edit__label'>类型</Text>
            <View
              className='card-edit__picker'
              onClick={() => openTypeDropdown()}
            >
              <View className='stop-edit__type-row'>
                <View
                  className='stop-edit__type-icon'
                  style={{ backgroundColor: lightenColor(typeMark.color) }}
                >
                  <TypeIcon size={14} color={typeMark.color} />
                </View>
                <Text className='card-edit__picker-text'>
                  {draft.typeOption.label}
                </Text>
              </View>
              <Text className='card-edit__picker-hint'>选择</Text>
            </View>
          </View>

          <View className='card-edit__field' id='stop-edit-mode-field'>
            <Text className='card-edit__label'>出行方式</Text>
            <View className='card-edit__key-row'>
              <View
                className='card-edit__check-hit'
                onClick={() =>
                  setDraft((prev) => {
                    if (!prev) return prev
                    const nextKey = !prev.isKeyNode
                    if (!nextKey) {
                      setModeOpen(false)
                    }
                    return {
                      ...prev,
                      isKeyNode: nextKey,
                      travelMode: prev.travelMode || 'walking',
                    }
                  })
                }
              >
                <View
                  className={`card-edit__check${
                    draft.isKeyNode ? ' card-edit__check--on' : ''
                  }`}
                >
                  {draft.isKeyNode ? (
                    <Text className='card-edit__check-mark'>✓</Text>
                  ) : null}
                </View>
              </View>
              <View
                className={`card-edit__picker card-edit__picker--compact${
                  draft.isKeyNode ? '' : ' card-edit__picker--disabled'
                }`}
                onClick={() => {
                  if (!draft.isKeyNode) return
                  openModeDropdown()
                }}
              >
                <View className='stop-edit__type-row'>
                  <View
                    className='stop-edit__type-icon'
                    style={{
                      backgroundColor: lightenColor(travelMeta.color),
                    }}
                  >
                    <TravelIcon size={14} color={travelMeta.color} />
                  </View>
                  <Text className='card-edit__picker-text'>
                    {travelMeta.label}
                  </Text>
                </View>
                <Text className='card-edit__picker-hint'>选择</Text>
              </View>
            </View>
          </View>

          <View className='card-edit__field'>
            <Text className='card-edit__label'>日期</Text>
            <Picker
              mode='date'
              value={dateValue}
              start={plan.startDate}
              end={dateEnd}
              onChange={(e) => {
                const next = dayIndexOfDate(plan.startDate, e.detail.value)
                setDraft((prev) =>
                  prev ? { ...prev, dayIndex: next } : prev,
                )
              }}
            >
              <View className='card-edit__picker'>
                <Text className='card-edit__picker-text'>{dateLabel}</Text>
                <Text className='card-edit__picker-hint'>选择</Text>
              </View>
            </Picker>
          </View>

          <View className='card-edit__field'>
            <Text className='card-edit__label'>时间</Text>
            <Picker
              mode='time'
              value={draft.time || '09:00'}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, time: e.detail.value } : prev,
                )
              }
            >
              <View className='card-edit__picker'>
                <Text className='card-edit__picker-text'>
                  {draft.time || '未设置'}
                </Text>
                <Text className='card-edit__picker-hint'>选择</Text>
              </View>
            </Picker>
            {draft.time ? (
              <Text
                className='card-edit__clear'
                onClick={() =>
                  setDraft((prev) => (prev ? { ...prev, time: '' } : prev))
                }
              >
                清除时间
              </Text>
            ) : null}
          </View>

          <View className='card-edit__field'>
            <Text className='card-edit__label'>备注</Text>
            <Textarea
              className='card-edit__textarea'
              value={draft.note}
              maxlength={200}
              placeholder='可选'
              autoHeight
              onInput={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, note: e.detail.value } : prev,
                )
              }
            />
          </View>
        </View>
      </ScrollView>

      <View className='stop-edit__actions'>
        <View
          className='stop-edit__btn stop-edit__btn--ghost'
          onClick={() => Taro.navigateBack()}
        >
          取消
        </View>
        <View
          className={`stop-edit__btn stop-edit__btn--primary${
            saving ? ' stop-edit__btn--disabled' : ''
          }`}
          onClick={onSave}
        >
          {saving ? '保存中…' : '保存'}
        </View>
      </View>

      {(typeAnim.mounted || modeAnim.mounted) && (
        <View
          className={`form-dropdown-mask${
            typeAnim.shown || modeAnim.shown ? ' form-dropdown-mask--open' : ''
          }`}
          onClick={closeDropdowns}
        />
      )}

      {typeAnim.mounted ? (
        <View
          className={`form-dropdown form-dropdown--type${
            typeAnim.shown ? ' form-dropdown--open' : ''
          }`}
          style={
            dropdownPos
              ? {
                  top: `${dropdownPos.top}px`,
                  left: `${dropdownPos.left}px`,
                  width: `${dropdownPos.width}px`,
                }
              : undefined
          }
        >
          <View
            className={`form-dropdown__grid form-dropdown__grid--cols-${
              dropdownPos?.cols || 4
            }`}
          >
            {PLACE_TYPE_OPTIONS.map((opt) => {
              const on = opt.typecode === draft.typeOption.typecode
              const MarkIcon = opt.mark.icon
              return (
                <View
                  key={`${opt.typecode}-${opt.label}`}
                  className={`form-dropdown__item${
                    on ? ' form-dropdown__item--on' : ''
                  }`}
                  onClick={() => {
                    setDraft((prev) =>
                      prev ? { ...prev, typeOption: opt } : prev,
                    )
                    closeDropdowns()
                  }}
                >
                  <View
                    className='form-dropdown__icon'
                    style={{
                      backgroundColor: lightenColor(opt.mark.color),
                    }}
                  >
                    <MarkIcon size={16} color={opt.mark.color} />
                  </View>
                  <Text className='form-dropdown__label'>{opt.label}</Text>
                </View>
              )
            })}
          </View>
        </View>
      ) : null}

      {modeAnim.mounted ? (
        <View
          className={`form-dropdown form-dropdown--mode${
            modeAnim.shown ? ' form-dropdown--open' : ''
          }`}
          style={
            dropdownPos
              ? {
                  top: `${dropdownPos.top}px`,
                  left: `${dropdownPos.left}px`,
                  width: `${dropdownPos.width}px`,
                }
              : undefined
          }
        >
          <View
            className={`form-dropdown__grid form-dropdown__grid--cols-${
              dropdownPos?.cols || 4
            }`}
          >
            {KEY_NODE_TRAVEL_MODES.map((item) => {
              const on = draft.travelMode === item.id && draft.isKeyNode
              const Icon = item.Icon
              return (
                <View
                  key={item.id}
                  className={`form-dropdown__item${
                    on ? ' form-dropdown__item--on' : ''
                  }`}
                  onClick={() => {
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            isKeyNode: true,
                            travelMode: item.id,
                          }
                        : prev,
                    )
                    closeDropdowns()
                  }}
                >
                  <View
                    className='form-dropdown__icon'
                    style={{
                      backgroundColor: lightenColor(item.color),
                    }}
                  >
                    <Icon size={16} color={item.color} />
                  </View>
                  <Text className='form-dropdown__label'>{item.label}</Text>
                </View>
              )
            })}
          </View>
        </View>
      ) : null}
    </View>
  )
}

import { View, Text, Input, Textarea, Picker, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import type { NavMode, TravelPlan } from '../../../types'
import {
  updatePlaceInfo,
  updateStopSchedule,
} from '../../../services/storage'
import { datePartOfDay, dayIndexOfDate } from '../../../utils/datetime'
import { useDropdownAnim } from '../../../hooks/useDropdownAnim'
import {
  PLACE_TYPE_OPTIONS,
  lightenColor,
  matchPlaceTypeOption,
  type PlaceTypeOption,
} from '../place-axis'
import type { TripStopView } from './TripBrowsePanel'

/** 关键节点前往方式：步行 / 公交 / 骑行 */
const KEY_NODE_TRAVEL_MODES: Array<{ id: NavMode; label: string }> = [
  { id: 'walking', label: '步行' },
  { id: 'transit', label: '公交' },
  { id: 'riding', label: '骑行' },
]

export type TripStopEditSheetProps = {
  open: boolean
  plan: TravelPlan
  stop: TripStopView | null
  onClose: () => void
  onSaved: (next: { dayIndex: number; stopId: string }) => void
}

type Draft = {
  name: string
  note: string
  dayIndex: number
  time: string
  typeOption: PlaceTypeOption
  isKeyNode: boolean
  travelMode: NavMode
}

function buildDraft(stop: TripStopView): Draft {
  return {
    name: stop.place.name || '',
    note: stop.note || '',
    dayIndex: stop.dayIndex,
    time: stop.time?.trim() || '',
    typeOption: matchPlaceTypeOption(stop.place),
    isKeyNode: !!stop.isKeyNode,
    travelMode:
      stop.travelMode === 'riding' || stop.travelMode === 'transit'
        ? stop.travelMode
        : 'walking',
  }
}

/** 行程卡片编辑：名称 / 关键节点 / 类型 / 日期 / 时间 / 备注 */
export function TripStopEditSheet({
  open,
  plan,
  stop,
  onClose,
  onSaved,
}: TripStopEditSheetProps) {
  const { mounted, shown } = useDropdownAnim(open)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [typeOpen, setTypeOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && stop) {
      setDraft(buildDraft(stop))
      setTypeOpen(false)
    }
    if (!open) {
      setTypeOpen(false)
      setDraft(null)
    }
  }, [open, stop])

  const dateValue = useMemo(() => {
    if (!draft) return plan.startDate
    return datePartOfDay(plan.startDate, draft.dayIndex)
  }, [draft, plan.startDate])

  const dateEnd = useMemo(
    () => datePartOfDay(plan.startDate, Math.max(plan.dayCount - 1, 30)),
    [plan.startDate, plan.dayCount],
  )

  const dateLabel = useMemo(() => {
    if (!draft) return ''
    const [y, m, d] = dateValue.split('-').map(Number)
    if (!y || !m || !d) return dateValue
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      new Date(y, m - 1, d).getDay()
    ]
    return `${m}月${d}日 · ${week}`
  }, [dateValue, draft])

  const travelModeIndex = useMemo(() => {
    if (!draft) return 0
    const idx = KEY_NODE_TRAVEL_MODES.findIndex((m) => m.id === draft.travelMode)
    return idx >= 0 ? idx : 0
  }, [draft])

  const travelModeLabel =
    KEY_NODE_TRAVEL_MODES[travelModeIndex]?.label || '步行'

  if (!mounted || !stop || !draft) return null

  const typeMark = draft.typeOption.mark
  const TypeIcon = typeMark.icon

  const onSave = () => {
    if (saving) return
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
      Taro.showToast({ title: '已保存', icon: 'success' })
      onSaved({ dayIndex: draft.dayIndex, stopId: stop.id })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <View
      className={`trip-stop-edit${shown ? ' trip-stop-edit--open' : ''}`}
      catchMove
    >
      <View className='trip-stop-edit__mask' onClick={onClose} />
      <View className='trip-stop-edit__panel'>
        <View className='trip-stop-edit__head'>
          <Text className='trip-stop-edit__title'>编辑行程</Text>
          <Text className='trip-stop-edit__close' onClick={onClose}>
            关闭
          </Text>
        </View>
        <ScrollView scrollY className='trip-stop-edit__body' enhanced>
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

            <View className='card-edit__field'>
              <View className='card-edit__key-row'>
                <View
                  className='card-edit__check-hit'
                  onClick={() =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            isKeyNode: !prev.isKeyNode,
                            travelMode: prev.travelMode || 'walking',
                          }
                        : prev,
                    )
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
                  <Text className='card-edit__check-label'>关键节点</Text>
                </View>
                {draft.isKeyNode ? (
                  <Picker
                    mode='selector'
                    range={KEY_NODE_TRAVEL_MODES.map((m) => m.label)}
                    value={travelModeIndex}
                    onChange={(e) => {
                      const idx = Number(e.detail.value)
                      const mode = KEY_NODE_TRAVEL_MODES[idx]?.id || 'walking'
                      setDraft((prev) =>
                        prev ? { ...prev, travelMode: mode } : prev,
                      )
                    }}
                  >
                    <View className='card-edit__picker card-edit__picker--compact'>
                      <Text className='card-edit__picker-text'>
                        {travelModeLabel}
                      </Text>
                      <Text className='card-edit__picker-hint'>选择</Text>
                    </View>
                  </Picker>
                ) : null}
              </View>
            </View>

            <View className='card-edit__field'>
              <Text className='card-edit__label'>类型</Text>
              <View
                className='card-edit__picker'
                onClick={() => setTypeOpen((v) => !v)}
              >
                <View className='trip-stop-edit__type-row'>
                  <View
                    className='trip-stop-edit__type-icon'
                    style={{ backgroundColor: lightenColor(typeMark.color) }}
                  >
                    <TypeIcon size={18} color={typeMark.color} />
                  </View>
                  <Text className='card-edit__picker-text'>
                    {draft.typeOption.label}
                  </Text>
                </View>
                <Text className='card-edit__picker-hint'>
                  {typeOpen ? '收起' : '选择'}
                </Text>
              </View>
              {typeOpen ? (
                <View className='type-grid'>
                  {PLACE_TYPE_OPTIONS.map((opt) => {
                    const on =
                      opt.typecode === draft.typeOption.typecode &&
                      opt.label === draft.typeOption.label
                    const Icon = opt.mark.icon
                    return (
                      <View
                        key={`${opt.typecode}-${opt.label}`}
                        className={`type-grid__item${
                          on ? ' type-grid__item--on' : ''
                        }`}
                        onClick={() => {
                          setDraft((prev) =>
                            prev ? { ...prev, typeOption: opt } : prev,
                          )
                          setTypeOpen(false)
                        }}
                      >
                        <View
                          className='type-grid__icon'
                          style={{
                            backgroundColor: lightenColor(opt.mark.color),
                          }}
                        >
                          <Icon size={18} color={opt.mark.color} />
                        </View>
                        <Text className='type-grid__label'>{opt.label}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : null}
            </View>

            <View className='card-edit__field'>
              <Text className='card-edit__label'>日期</Text>
              <Picker
                mode='date'
                value={dateValue}
                start={plan.startDate}
                end={dateEnd}
                onChange={(e) => {
                  const next = String(e.detail.value || '')
                  if (!next) return
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          dayIndex: dayIndexOfDate(plan.startDate, next),
                        }
                      : prev,
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
                onChange={(e) => {
                  const next = String(e.detail.value || '')
                  setDraft((prev) =>
                    prev ? { ...prev, time: next } : prev,
                  )
                }}
              >
                <View className='card-edit__picker'>
                  <Text className='card-edit__picker-text'>
                    {draft.time || '未设置'}
                  </Text>
                  <Text className='card-edit__picker-hint'>选择</Text>
                </View>
              </Picker>
              {!!draft.time && (
                <Text
                  className='card-edit__clear'
                  onClick={() =>
                    setDraft((prev) => (prev ? { ...prev, time: '' } : prev))
                  }
                >
                  清除时间
                </Text>
              )}
            </View>

            <View className='card-edit__field'>
              <Text className='card-edit__label'>备注</Text>
              <Textarea
                className='card-edit__textarea'
                value={draft.note}
                maxlength={2000}
                placeholder='开放时间、门票、怎么走等'
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
        <View className='trip-stop-edit__foot'>
          <View className='trip-stop-edit__btn' onClick={onClose}>
            取消
          </View>
          <View
            className={`trip-stop-edit__btn trip-stop-edit__btn--primary${
              saving ? ' trip-stop-edit__btn--disabled' : ''
            }`}
            onClick={onSave}
          >
            {saving ? '保存中…' : '保存'}
          </View>
        </View>
      </View>
    </View>
  )
}

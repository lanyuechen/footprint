import {
  View,
  Text,
  ScrollView,
  Picker,
  Input,
  Textarea,
} from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import { useMemo, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import { GroupedSortList, type SortGroup } from './GroupedSortList'
import {
  applyPlaceTypeOption,
  lightenColor,
  matchPlaceTypeOption,
  placeAxisMark,
  PLACE_TYPE_OPTIONS,
  type PlaceTypeOption,
} from './place-axis'
import { buildTimelineYears } from './timeline-model'

type TimelineStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

type PlaceInfoPatch = {
  name?: string
  type?: string
  typecode?: string
}

type TimelineViewProps = {
  plan: TravelPlan
  places: CollectedPlace[]
  stops: TripStop[]
  onRemoveStop: (stopId: string) => void
  onReschedule: (
    stopId: string,
    input: { dayIndex?: number; time?: string | null; note?: string | null },
  ) => void
  onUpdatePlace: (placeId: string, input: PlaceInfoPatch) => void
  onReorderGroups: (groups: SortGroup<TimelineStopView>[]) => void
  onAddDay: () => void
}

type EditDraft = {
  stopId: string
  placeId: string
  name: string
  typecode: string
  typeLabel: string
  /** HH:mm，空表示未设置 */
  time: string
  dayIndex: number
  note: string
}

export function TimelineView({
  plan,
  places,
  stops,
  onRemoveStop,
  onReschedule,
  onUpdatePlace,
  onReorderGroups,
  onAddDay,
}: TimelineViewProps) {
  const [expandedId, setExpandedId] = useState('')
  const [typePickPlaceId, setTypePickPlaceId] = useState('')
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)

  const years = useMemo(
    () => buildTimelineYears(plan, stops, places),
    [plan, stops, places],
  )

  const groups: SortGroup<TimelineStopView>[] = useMemo(
    () =>
      years.flatMap((year) =>
        year.days.map((day) => ({
          id: String(day.dayIndex),
          title: day.label,
          subtitle: day.weekday,
          items: day.stops,
        })),
      ),
    [years],
  )

  /** 展开态 + 备注变更都要触发列表重新测高 */
  const layoutKey = useMemo(
    () =>
      `${expandedId}|${stops.map((s) => `${s.id}:${s.note || ''}`).join(',')}`,
    [expandedId, stops],
  )

  const typePickPlace = typePickPlaceId
    ? places.find((p) => p.id === typePickPlaceId)
    : undefined
  const typePickCurrent = editDraft
    ? PLACE_TYPE_OPTIONS.find((o) => o.typecode === editDraft.typecode) ||
      PLACE_TYPE_OPTIONS[0]
    : typePickPlace
      ? matchPlaceTypeOption(typePickPlace.place)
      : null

  const openAdd = (dayIndex: number) => {
    Taro.navigateTo({
      url: `/pages/place-add/index?id=${plan.id}&day=${dayIndex}`,
    })
  }

  const openTypePick = (placeId: string) => {
    setEditDraft(null)
    setTypePickPlaceId(placeId)
  }

  const applyType = (option: PlaceTypeOption) => {
    if (editDraft) {
      setEditDraft({
        ...editDraft,
        typecode: option.typecode,
        typeLabel: option.label,
      })
      setTypePickPlaceId('')
      return
    }
    if (!typePickPlaceId || !typePickPlace) return
    const next = applyPlaceTypeOption(typePickPlace.place, option)
    onUpdatePlace(typePickPlaceId, {
      type: next.type || '',
      typecode: next.typecode || '',
    })
    setTypePickPlaceId('')
  }

  const openEdit = (point: TimelineStopView) => {
    const opt = matchPlaceTypeOption(point.place)
    const note = point.note || ''
    setTypePickPlaceId('')
    setEditDraft({
      stopId: point.id,
      placeId: point.collected.id,
      name: point.place.name,
      typecode: opt.typecode,
      typeLabel: opt.label,
      time: point.time || '',
      dayIndex: point.dayIndex,
      note,
    })
  }

  const saveEdit = () => {
    if (!editDraft) return
    const name = editDraft.name.trim()
    if (!name) {
      Taro.showToast({ title: '标题不能为空', icon: 'none' })
      return
    }
    const option =
      PLACE_TYPE_OPTIONS.find((o) => o.typecode === editDraft.typecode) ||
      PLACE_TYPE_OPTIONS[0]
    onUpdatePlace(editDraft.placeId, {
      name,
      type: option.type,
      typecode: option.typecode,
    })
    onReschedule(editDraft.stopId, {
      dayIndex: editDraft.dayIndex,
      time: editDraft.time.trim() || null,
      note: editDraft.note.trim() || null,
    })
    setEditDraft(null)
    Taro.showToast({ title: '已保存', icon: 'success' })
  }

  const dayPickerRange = useMemo(() => {
    const count = Math.max(1, plan.dayCount || 1)
    return Array.from({ length: count }, (_, i) => {
      const [sy, sm, sd] = plan.startDate.split('-').map(Number)
      const dt = new Date(sy, sm - 1, sd + i)
      return `${dt.getMonth() + 1}月${dt.getDate()}日`
    })
  }, [plan.startDate, plan.dayCount])

  return (
    <View className='timeline-view'>
      <GroupedSortList
        groups={groups}
        layoutKey={layoutKey}
        onItemClick={(id) => {
          setExpandedId((cur) => (cur === id ? '' : id))
        }}
        onDragStart={() => setExpandedId('')}
        onChange={(next) => {
          setExpandedId('')
          onReorderGroups(next)
        }}
        headerSlot={
          <View className='timeline-view__hero'>
            <Text className='timeline-view__title'>{plan.name}</Text>
            {!!plan.startDate && (
              <Text className='timeline-view__meta'>{plan.startDate}</Text>
            )}
            {!!plan.description ? (
              <Text className='timeline-view__desc'>{plan.description}</Text>
            ) : (
              <Text className='timeline-view__desc timeline-view__desc--muted'>
                暂无描述
              </Text>
            )}
          </View>
        }
        footerSlot={
          <View
            className='gsl-row gsl-row--header'
            onClick={(e) => {
              e.stopPropagation()
              onAddDay()
            }}
          >
            <View className='gsl-rail'>
              <View className='gsl-rail__dot gsl-rail__dot--day' />
            </View>
            <View className='grouped-sort__footer-add'>
              <Text className='grouped-sort__footer-add-text'>添加日期</Text>
            </View>
          </View>
        }
        renderHeader={(group, { dragging }) => (
          <View className='gsl-row gsl-row--header'>
            <View className='gsl-rail'>
              <View className='gsl-rail__dot gsl-rail__dot--day' />
            </View>
            <View className='grouped-sort__header-row'>
              <View className='grouped-sort__header-main'>
                <Text className='grouped-sort__header-title'>{group.title}</Text>
                {!!group.subtitle && (
                  <Text className='grouped-sort__header-sub'>{group.subtitle}</Text>
                )}
              </View>
              {!dragging && (
                <View
                  className='grouped-sort__header-add'
                  onClick={(e) => {
                    e.stopPropagation()
                    openAdd(Number(group.id))
                  }}
                >
                  + 添加
                </View>
              )}
            </View>
          </View>
        )}
        renderItem={(point, { dragging }) => {
          const axisMark = placeAxisMark(point.place)
          const AxisIcon = axisMark.icon
          const open = expandedId === point.id && !dragging
          const timeLabel = point.time?.trim() || ''
          return (
            <View className='gsl-row'>
              <View className='gsl-rail'>
                <View
                  className='gsl-rail__dot gsl-rail__dot--point'
                  style={{ backgroundColor: lightenColor(axisMark.color) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragging) return
                    openTypePick(point.collected.id)
                  }}
                >
                  <AxisIcon size={14} color={axisMark.color} />
                </View>
              </View>
              <View
                className={`gsl-card${dragging ? ' gsl-card--active' : ''}${
                  open ? ' gsl-card--open' : ''
                }`}
              >
                <View className='gsl-card__row'>
                  <View className='gsl-card__main'>
                    {!!timeLabel && (
                      <View className='gsl-card__time-wrap'>
                        <Picker
                          mode='time'
                          value={timeLabel}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = e.detail.value
                            if (next !== point.time) {
                              onReschedule(point.id, { time: next })
                            }
                          }}
                        >
                          <View
                            className='gsl-card__time gsl-card__time--set'
                            onClick={(e) => e.stopPropagation()}
                          >
                            {timeLabel}
                          </View>
                        </Picker>
                      </View>
                    )}
                    <View className='gsl-card__name'>{point.place.name}</View>
                    {!!point.place.address && (
                      <View className='gsl-card__addr'>{point.place.address}</View>
                    )}
                  </View>
                  <View
                    className={`gsl-card__actions${
                      dragging ? ' gsl-card__actions--hidden' : ''
                    }`}
                  >
                    <View
                      className='gsl-card__icon'
                      onClick={(e) => {
                        e.stopPropagation()
                        Taro.navigateTo({
                          url: `/pages/nav/index?pointId=${point.placeId}`,
                        })
                      }}
                    >
                      <Navigation size={16} color='#1a5f4a' />
                    </View>
                  </View>
                </View>
                <View className='gsl-card__detail'>
                  <View className='gsl-card__detail-inner'>
                    <View
                      className='gsl-card__detail-note'
                      onClick={(e) => {
                        e.stopPropagation()
                        Taro.navigateTo({
                          url: `/pages/point-note/index?stopId=${point.id}`,
                        })
                      }}
                    >
                      {point.note?.trim() ? (
                        <View className='gsl-card__detail-text'>
                          {point.note}
                        </View>
                      ) : (
                        <View className='gsl-card__detail-empty'>暂无备注</View>
                      )}
                    </View>
                    <View className='gsl-card__detail-divider' />
                    <View className='gsl-card__detail-actions'>
                      <View
                        className='gsl-card__detail-edit'
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(point)
                        }}
                      >
                        <SquarePen size={14} color='#1a5f4a' />
                        <Text className='gsl-card__detail-edit-text'>编辑</Text>
                      </View>
                      <View
                        className='gsl-card__detail-delete'
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveStop(point.id)
                        }}
                      >
                        <Trash2 size={14} color='#c45656' />
                        <Text className='gsl-card__detail-delete-text'>删除</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )
        }}
      />

      {typePickPlaceId ? (
        <View className='place-picker'>
          <View
            className='place-picker__mask'
            onClick={() => setTypePickPlaceId('')}
          />
          <View className='place-picker__sheet'>
            <View className='place-picker__head'>
              <Text className='place-picker__title'>选择类型</Text>
              <Text
                className='place-picker__add-place'
                onClick={() => setTypePickPlaceId('')}
              >
                关闭
              </Text>
            </View>
            <View className='place-picker__sub'>
              {editDraft?.name || typePickPlace?.place.name || '修改时间轴图标'}
            </View>
            <ScrollView scrollY className='place-picker__list'>
              <View className='type-grid'>
                {PLACE_TYPE_OPTIONS.map((opt) => {
                  const Icon = opt.mark.icon
                  const on =
                    typePickCurrent?.mark.marker === opt.mark.marker &&
                    typePickCurrent?.typecode === opt.typecode
                  return (
                    <View
                      key={`${opt.typecode}-${opt.mark.marker}`}
                      className={`type-grid__item${on ? ' type-grid__item--on' : ''}`}
                      onClick={() => applyType(opt)}
                    >
                      <View
                        className='type-grid__icon'
                        style={{ backgroundColor: lightenColor(opt.mark.color) }}
                      >
                        <Icon size={18} color={opt.mark.color} />
                      </View>
                      <Text className='type-grid__label'>{opt.label}</Text>
                    </View>
                  )
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      ) : editDraft ? (
        <View className='place-picker'>
          <View className='place-picker__mask' onClick={() => setEditDraft(null)} />
          <View className='place-picker__sheet place-picker__sheet--edit'>
            <View className='place-picker__head'>
              <Text className='place-picker__title'>编辑卡片</Text>
              <Text
                className='place-picker__add-place'
                onClick={() => setEditDraft(null)}
              >
                关闭
              </Text>
            </View>
            <ScrollView scrollY className='place-picker__list place-picker__list--edit'>
              <View className='card-edit'>
                <View className='card-edit__field'>
                  <Text className='card-edit__label'>标题</Text>
                  <Input
                    className='card-edit__input'
                    value={editDraft.name}
                    maxlength={60}
                    placeholder='地点名称'
                    onInput={(e) =>
                      setEditDraft({ ...editDraft, name: e.detail.value })
                    }
                  />
                </View>
                <View className='card-edit__field'>
                  <Text className='card-edit__label'>类型</Text>
                  <View
                    className='card-edit__picker'
                    onClick={() => setTypePickPlaceId(editDraft.placeId)}
                  >
                    <Text className='card-edit__picker-text'>
                      {editDraft.typeLabel}
                    </Text>
                    <Text className='card-edit__picker-hint'>点击选择</Text>
                  </View>
                </View>
                <View className='card-edit__field'>
                  <Text className='card-edit__label'>日期</Text>
                  <Picker
                    mode='selector'
                    range={dayPickerRange}
                    value={Math.min(
                      editDraft.dayIndex,
                      Math.max(0, dayPickerRange.length - 1),
                    )}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        dayIndex: Number(e.detail.value) || 0,
                      })
                    }
                  >
                    <View className='card-edit__picker'>
                      <Text className='card-edit__picker-text'>
                        {dayPickerRange[editDraft.dayIndex] ||
                          `第 ${editDraft.dayIndex + 1} 天`}
                      </Text>
                      <Text className='card-edit__picker-hint'>点击修改</Text>
                    </View>
                  </Picker>
                </View>
                <View className='card-edit__field'>
                  <Text className='card-edit__label'>时间</Text>
                  <Picker
                    mode='time'
                    value={editDraft.time || '09:00'}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, time: e.detail.value })
                    }
                  >
                    <View className='card-edit__picker'>
                      <Text className='card-edit__picker-text'>
                        {editDraft.time || '未设置'}
                      </Text>
                      <Text className='card-edit__picker-hint'>点击设置</Text>
                    </View>
                  </Picker>
                  {!!editDraft.time && (
                    <Text
                      className='card-edit__clear'
                      onClick={() => setEditDraft({ ...editDraft, time: '' })}
                    >
                      清除时间
                    </Text>
                  )}
                </View>
                <View className='card-edit__field'>
                  <Text className='card-edit__label'>备注</Text>
                  <Textarea
                    className='card-edit__textarea'
                    value={editDraft.note}
                    maxlength={500}
                    placeholder='可选备注'
                    autoHeight
                    onInput={(e) =>
                      setEditDraft({ ...editDraft, note: e.detail.value })
                    }
                  />
                </View>
              </View>
            </ScrollView>
            <View className='place-picker__actions'>
              <View
                className='place-picker__btn'
                onClick={() => setEditDraft(null)}
              >
                取消
              </View>
              <View
                className='place-picker__btn place-picker__btn--primary'
                onClick={saveEdit}
              >
                保存
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

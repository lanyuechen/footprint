import { View, Text, ScrollView, Picker, RichText } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import { useMemo, useState } from 'react'
import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import {
  combineDateTime,
  formatClock,
  toDatePart,
  toTimePart,
} from '../../utils/datetime'
import { GroupedSortList, type SortGroup } from './GroupedSortList'
import { lightenColor, placeAxisMark } from './place-axis'
import { placeInfoRows } from './place-info'
import { buildTimelineYears } from './timeline-model'

type TimelineStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

type TimelineViewProps = {
  plan: TravelPlan
  places: CollectedPlace[]
  stops: TripStop[]
  onRemoveStop: (stopId: string) => void
  onReschedule: (stopId: string, expectedAt: string) => void
  onReorderGroups: (groups: SortGroup<TimelineStopView>[]) => void
  onAddStops: (datePart: string, placeIds: string[]) => void
  onAddDay: () => void
  onAddPlace: () => void
}

export function TimelineView({
  plan,
  places,
  stops,
  onRemoveStop,
  onReschedule,
  onReorderGroups,
  onAddStops,
  onAddDay,
  onAddPlace,
}: TimelineViewProps) {
  const [addDayKey, setAddDayKey] = useState('')
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState('')

  const years = useMemo(
    () => buildTimelineYears(plan, stops, places),
    [plan, stops, places],
  )

  const groups: SortGroup<TimelineStopView>[] = useMemo(
    () =>
      years.flatMap((year) =>
        year.days.map((day) => ({
          id: day.datePart,
          title: day.label,
          subtitle: day.weekday,
          items: day.stops,
        })),
      ),
    [years],
  )

  const openAdd = (datePart: string) => {
    setPickedIds([])
    setAddDayKey(datePart)
  }

  const togglePick = (placeId: string) => {
    setPickedIds((prev) =>
      prev.includes(placeId) ? prev.filter((id) => id !== placeId) : [...prev, placeId],
    )
  }

  const confirmAdd = () => {
    if (!addDayKey || pickedIds.length === 0) {
      Taro.showToast({ title: '请选择地点', icon: 'none' })
      return
    }
    onAddStops(addDayKey, pickedIds)
    setAddDayKey('')
    setPickedIds([])
  }

  return (
    <View className='timeline-view'>
      <GroupedSortList
        groups={groups}
        layoutKey={expandedId}
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
                    openAdd(group.id)
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
          return (
            <View className='gsl-row'>
              <View className='gsl-rail'>
                <View
                  className='gsl-rail__dot gsl-rail__dot--point'
                  style={{ backgroundColor: lightenColor(axisMark.color) }}
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
                    <View className='gsl-card__time-wrap'>
                      <Picker
                        mode='time'
                        value={toTimePart(point.expectedAt)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = combineDateTime(
                            toDatePart(point.expectedAt),
                            e.detail.value,
                          )
                          if (next !== point.expectedAt) {
                            onReschedule(point.id, next)
                          }
                        }}
                      >
                        <View
                          className='gsl-card__time'
                          onClick={(e) => e.stopPropagation()}
                        >
                          {formatClock(point.expectedAt)}
                        </View>
                      </Picker>
                    </View>
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
                    <View className='gsl-card__detail-actions'>
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
                    {placeInfoRows(point.place).map((row) => (
                      <View key={row.label} className='gsl-card__info-row'>
                        <View className='gsl-card__info-label'>{row.label}</View>
                        <View className='gsl-card__info-value'>{row.value}</View>
                      </View>
                    ))}
                    <View className='gsl-card__detail-divider' />
                    {point.collected.noteHtml?.trim() ? (
                      <RichText
                        className='gsl-card__detail-html'
                        nodes={point.collected.noteHtml}
                      />
                    ) : point.collected.noteText?.trim() ? (
                      <View className='gsl-card__detail-text'>
                        {point.collected.noteText}
                      </View>
                    ) : (
                      <View className='gsl-card__detail-empty'>暂无备注</View>
                    )}
                  </View>
                </View>
              </View>
            </View>
          )
        }}
      />

      {addDayKey ? (
        <View className='place-picker'>
          <View className='place-picker__mask' onClick={() => setAddDayKey('')} />
          <View className='place-picker__sheet'>
            <View className='place-picker__head'>
              <Text className='place-picker__title'>添加到行程</Text>
              <Text
                className='place-picker__add-place'
                onClick={(e) => {
                  e.stopPropagation()
                  setAddDayKey('')
                  onAddPlace()
                }}
              >
                添加地点
              </Text>
            </View>
            <View className='place-picker__sub'>可多选，同一地点可重复添加</View>
            <ScrollView scrollY className='place-picker__list'>
              {places.length === 0 ? (
                <View className='place-picker__empty'>暂无收藏地点，请先添加</View>
              ) : (
                places.map((item) => {
                  const selected = pickedIds.includes(item.id)
                  return (
                    <View
                      key={item.id}
                      className={`place-picker__item${
                        selected ? ' place-picker__item--on' : ''
                      }`}
                      onClick={() => togglePick(item.id)}
                    >
                      <View
                        className={`place-picker__check${
                          selected ? ' place-picker__check--on' : ''
                        }`}
                      />
                      <View className='place-picker__body'>
                        <View className='place-picker__name'>{item.place.name}</View>
                        {!!item.place.address && (
                          <View className='place-picker__addr'>{item.place.address}</View>
                        )}
                      </View>
                    </View>
                  )
                })
              )}
            </ScrollView>
            <View className='place-picker__actions'>
              <View className='place-picker__btn' onClick={() => setAddDayKey('')}>
                取消
              </View>
              <View
                className='place-picker__btn place-picker__btn--primary'
                onClick={confirmAdd}
              >
                添加{pickedIds.length > 0 ? `（${pickedIds.length}）` : ''}
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

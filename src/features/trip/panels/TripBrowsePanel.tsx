import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, type ReactNode } from 'react'
import { EllipsisVertical } from 'lucide-react-taro/icons/ellipsis-vertical'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import type { CollectedPlace, TripStop } from '../../../types'
import { GroupedSortList, type SortGroup } from '../GroupedSortList'
import { placeAxisMark, lightenColor } from '../place-axis'
import { useDropdownAnim } from '../../../hooks/useDropdownAnim'

export type TripStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

/** 浏览模式 sheet 顶栏：日期 + 摘要 + 添加 */
export function TripBrowseHeader({
  dayStopsCount,
  dayTabs,
  onAddTrip,
}: {
  dayStopsCount: number
  dayTabs: ReactNode
  onAddTrip: () => void
}) {
  return (
    <>
      <View className='sheet__handle'>
        <View className='sheet__handle-bar' />
      </View>
      {dayTabs}
      <View className='trip-sheet__summary'>
        <Text className='trip-sheet__sub'>
          {dayStopsCount > 0
            ? `${dayStopsCount} 个行程 · 长按拖动排序`
            : '当天暂无行程'}
        </Text>
      </View>
      <View
        className='trip-sheet__add'
        onClick={(e) => {
          e.stopPropagation()
          onAddTrip()
        }}
      >
        <Text className='trip-sheet__add-text'>+ 添加行程</Text>
      </View>
    </>
  )
}

function TripStopCard({
  stop,
  dragging,
  selected,
  menuOpen,
  onToggleMenu,
  onEditStop,
  onRemoveStop,
}: {
  stop: TripStopView
  dragging: boolean
  selected: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onEditStop: (stop: TripStopView) => void
  onRemoveStop: (stopId: string) => void
}) {
  const axis = placeAxisMark(stop.place)
  const AxisIcon = axis.icon
  const timeLabel = stop.time?.trim() || ''
  const note = stop.note?.trim() || ''
  const { mounted, shown } = useDropdownAnim(menuOpen)

  const goNav = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    Taro.navigateTo({
      url: `/pages/nav/index?placeId=${stop.placeId}`,
    })
  }

  const goEdit = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (menuOpen) onToggleMenu()
    onEditStop(stop)
  }

  const doDelete = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    onRemoveStop(stop.id)
  }

  return (
    <View
      id={`trip-stop-${stop.id}`}
      className={`gsl-row${mounted ? ' gsl-row--menu-open' : ''}`}
    >
      <View className='gsl-rail'>
        <View
          className='gsl-rail__dot gsl-rail__dot--point'
          style={{ backgroundColor: lightenColor(axis.color) }}
        >
          <AxisIcon size={14} color={axis.color} />
        </View>
      </View>
      <View
        className={`gsl-card gsl-card--flat${
          dragging ? ' gsl-card--active' : ''
        }${selected && !dragging ? ' gsl-card--selected' : ''}`}
      >        <View className='gsl-card__row'>
          <View className='gsl-card__main'>
            {!!timeLabel && (
              <View className='gsl-card__time-wrap'>
                <View className='gsl-card__time gsl-card__time--set'>
                  {timeLabel}
                </View>
              </View>
            )}
            <View className='gsl-card__name'>{stop.place.name}</View>
            {!!stop.place.address && (
              <View className='gsl-card__addr'>{stop.place.address}</View>
            )}
            {!!note && <View className='gsl-card__note'>{note}</View>}
          </View>
          <View
            className={`gsl-card__actions${
              dragging ? ' gsl-card__actions--hidden' : ''
            }`}
          >
            <View className='gsl-card__icon' onClick={goNav}>
              <Navigation size={16} color='#1a5f4a' />
            </View>
            <View className='gsl-card__more-wrap'>
              <View
                className='gsl-card__icon'
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleMenu()
                }}
              >
                <EllipsisVertical size={16} color='#8a9199' />
              </View>
              {mounted ? (
                <View
                  className={`gsl-card__menu${
                    shown ? ' gsl-card__menu--open' : ''
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <View className='gsl-card__menu-item' onClick={goEdit}>
                    <SquarePen size={16} color='#1a5f4a' />
                    <Text className='gsl-card__menu-label'>编辑</Text>
                  </View>
                  <View
                    className='gsl-card__menu-item gsl-card__menu-item--danger'
                    onClick={doDelete}
                  >
                    <Trash2 size={16} color='#c45656' />
                    <Text className='gsl-card__menu-label gsl-card__menu-label--danger'>
                      删除
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export type TripBrowseListProps = {
  dayStops: TripStopView[]
  sortGroups: SortGroup<TripStopView>[]
  selectedStopId: string
  listScrollId: string
  listScrollSeq: number
  /** 可移除空日（计划至少 2 天） */
  canRemoveDay?: boolean
  onItemClick: (id: string) => void
  onDragStart: () => void
  onChange: (groups: SortGroup<TripStopView>[]) => void
  onEditStop: (stop: TripStopView) => void
  onRemoveStop: (stopId: string) => void
  onRemoveDay?: () => void
}

/** 浏览模式：当日行程拖拽列表 */
export function TripBrowseList({
  dayStops,
  sortGroups,
  selectedStopId,
  listScrollId,
  listScrollSeq,
  canRemoveDay,
  onItemClick,
  onDragStart,
  onChange,
  onEditStop,
  onRemoveStop,
  onRemoveDay,
}: TripBrowseListProps) {
  const [menuId, setMenuId] = useState<string | null>(null)

  if (dayStops.length === 0) {
    return (
      <View className='trip-sheet__empty'>
        <Text className='trip-sheet__empty-text'>这一天还没有安排行程</Text>
        {canRemoveDay && onRemoveDay ? (
          <View
            className='trip-sheet__remove-day'
            onClick={(e) => {
              e.stopPropagation()
              onRemoveDay()
            }}
          >
            <Trash2 size={16} color='#c45c5c' />
            <Text className='trip-sheet__remove-day-text'>移除当日</Text>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View
      className='trip-sheet__sort'
      onClick={() => {
        if (menuId) setMenuId(null)
      }}
    >
      <GroupedSortList
        groups={sortGroups}
        headerHeight={0}
        elevatedId={menuId || undefined}
        layoutKey={`${selectedStopId}|${dayStops
          .map(
            (s) =>
              `${s.id}:${s.note || ''}:${s.time || ''}:${s.dayIndex}:${s.place.name}:${s.place.typecode || ''}`,
          )
          .join(',')}`}
        scrollToId={listScrollId}
        scrollToSeq={listScrollSeq}
        onItemClick={(id) => {
          setMenuId(null)
          onItemClick(id)
        }}
        onDragStart={() => {
          setMenuId(null)
          onDragStart()
        }}
        onChange={onChange}
        renderItem={(stop, { dragging }) => (
          <TripStopCard
            stop={stop}
            dragging={dragging}
            selected={selectedStopId === stop.id}
            menuOpen={menuId === stop.id}
            onToggleMenu={() =>
              setMenuId((prev) => (prev === stop.id ? null : stop.id))
            }
            onEditStop={(s) => {
              setMenuId(null)
              onEditStop(s)
            }}
            onRemoveStop={(stopId) => {
              setMenuId(null)
              onRemoveStop(stopId)
            }}
          />
        )}
      />
    </View>
  )
}

import { View, Text, Picker, Textarea, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState, type ReactNode } from 'react'
import { AlarmClock } from 'lucide-react-taro/icons/alarm-clock'
import { EllipsisVertical } from 'lucide-react-taro/icons/ellipsis-vertical'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { SquarePen } from 'lucide-react-taro/icons/square-pen'
import { Trash2 } from 'lucide-react-taro/icons/trash-2'
import type { CollectedPlace, NavMode, TripStop } from '../../../types'
import { updatePlaceInfo, updateStopSchedule } from '../../../services/storage'
import { formatDistance, formatDuration } from '../../../utils/datetime'
import { GroupedSortList, type SortGroup } from '../GroupedSortList'
import {
  placeAxisMark,
  lightenColor,
  matchPlaceTypeOption,
} from '../place-axis'
import { navModeMeta, normalizeNavMode } from '../nav-mode'
import { useDropdownAnim } from '../../../hooks/useDropdownAnim'
import { useKeyboardHeight } from '../../../hooks/useKeyboardHeight'

export type TripStopView = TripStop & {
  place: CollectedPlace['place']
  collected: CollectedPlace
}

function keyNodeTravelMeta(mode?: NavMode) {
  const meta = navModeMeta(mode)
  return { label: `${meta.label}前往`, Icon: meta.Icon }
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
  prevStop,
  index,
  dragging,
  selected,
  menuOpen,
  onToggleMenu,
  onEditStop,
  onRemoveStop,
  onPickName,
  onPickNote,
  onStopUpdated,
  routeLegByToStopId,
  quickEditEnabled,
}: {
  stop: TripStopView
  prevStop: TripStopView | null
  index: number
  dragging: boolean
  selected: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onEditStop: (stop: TripStopView) => void
  onRemoveStop: (stopId: string) => void
  onPickName: (stop: TripStopView) => void
  onPickNote: (stop: TripStopView) => void
  onStopUpdated?: () => void
  /** 到达该关键节点的路径距离 / 耗时 */
  routeLegByToStopId?: Record<
    string,
    { distanceMeters: number; durationSeconds?: number }
  >
  /** sheet 顶部时才允许点名称 / 备注快速编辑 */
  quickEditEnabled?: boolean
}) {
  const timeLabel = stop.time?.trim() || ''
  const note = stop.note?.trim() || ''
  const { mounted, shown } = useDropdownAnim(menuOpen)
  const canQuickEdit = quickEditEnabled !== false
  const keyTravel = stop.isKeyNode ? keyNodeTravelMeta(stop.travelMode) : null
  const KeyTravelIcon = keyTravel?.Icon
  const leg = routeLegByToStopId?.[stop.id]
  const routeDistLabel = formatDistance(leg?.distanceMeters)
  const routeDurLabel = formatDuration(leg?.durationSeconds)
  const travelLabel = routeDistLabel
    ? routeDurLabel
      ? `${routeDistLabel} · ${routeDurLabel}`
      : routeDistLabel
    : keyTravel?.label || ''
  const axis = placeAxisMark(stop.place)
  const typeOption = matchPlaceTypeOption(stop.place)
  const TypeIcon = typeOption.mark.icon
  const typeColor = typeOption.mark.color
  const dotStyle = selected
    ? { backgroundColor: axis.color }
    : { backgroundColor: lightenColor(axis.color) }
  const numStyle = { color: selected ? '#ffffff' : axis.color }

  const goNav = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    Taro.navigateTo({
      url: `/pages/nav/index?placeId=${stop.placeId}`,
    })
  }

  const goKeyNodeNav = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (!prevStop) {
      Taro.showToast({ title: '没有上一个节点', icon: 'none' })
      return
    }
    const mode = normalizeNavMode(stop.travelMode) || 'walking'
    const fromName = encodeURIComponent(prevStop.place.name || '起点')
    // 车次一般写在起点备注里，用上一段起点（上一关键节点）备注匹配
    const note = encodeURIComponent(prevStop.note?.trim() || '')
    Taro.navigateTo({
      url:
        `/pages/nav/index?placeId=${encodeURIComponent(stop.placeId)}` +
        `&fromLat=${prevStop.place.latitude}` +
        `&fromLng=${prevStop.place.longitude}` +
        `&fromName=${fromName}` +
        `&mode=${mode}` +
        (note ? `&note=${note}` : ''),
    })
  }

  const goEdit = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (menuOpen) onToggleMenu()
    onEditStop(stop)
  }

  const doDelete = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    const name = stop.place.name?.trim() || '该行程'
    Taro.showModal({
      title: '删除行程',
      content: `确定删除「${name}」？`,
      confirmText: '删除',
      confirmColor: '#c45c5c',
      success: (res) => {
        if (!res.confirm) return
        onRemoveStop(stop.id)
      },
    })
  }

  const setTime = (next: string) => {
    const updated = updateStopSchedule(stop.id, { time: next || null })
    if (!updated) {
      Taro.showToast({ title: '设置失败', icon: 'none' })
      return
    }
    onStopUpdated?.()
  }

  return (
    <View
      id={`trip-stop-${stop.id}`}
      className={`gsl-row${mounted ? ' gsl-row--menu-open' : ''}`}
    >
      <View className='gsl-rail'>
        <View className='gsl-rail__dot gsl-rail__dot--point' style={dotStyle}>
          <Text className='gsl-rail__num' style={numStyle}>
            {index}
          </Text>
        </View>
      </View>
      <View
        className={`gsl-card gsl-card--flat${
          dragging ? ' gsl-card--active' : ''
        }`}
        style={{
          background: `linear-gradient(105deg, ${lightenColor(
            typeColor,
            0.72,
          )} 0%, ${lightenColor(typeColor, 0.9)} 32%, #ffffff 68%)`,
        }}
      >
        <View className='gsl-card__wash' aria-hidden>
          <View className='gsl-card__mark'>
            <TypeIcon size={78} color={typeColor} />
          </View>
          <View
            className='gsl-card__mark-fade'
            style={{
              background: `linear-gradient(90deg, transparent 0%, ${lightenColor(
                typeColor,
                0.94,
              )} 42%, #ffffff 100%)`,
            }}
          />
        </View>
        <View className='gsl-card__row'>
          <View className='gsl-card__main'>
            <View className='gsl-card__tags'>
              {!!timeLabel ? (
                <Picker
                  mode='time'
                  value={timeLabel}
                  onChange={(e) => {
                    const next = String(e.detail.value || '').trim()
                    if (!next || next === timeLabel) return
                    setTime(next)
                  }}
                >
                  <View
                    className='gsl-card__time gsl-card__time--set'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlarmClock size={12} color='#c45656' />
                    <Text className='gsl-card__time-text'>{timeLabel}</Text>
                  </View>
                </Picker>
              ) : null}
              {keyTravel && KeyTravelIcon ? (
                <View className='gsl-card__travel' onClick={goKeyNodeNav}>
                  <KeyTravelIcon size={12} color='#1a5f4a' />
                  <Text className='gsl-card__travel-text'>{travelLabel}</Text>
                </View>
              ) : null}
            </View>
            <View
              className={`gsl-card__name${
                canQuickEdit ? '' : ' gsl-card__name--readonly'
              }`}
            >
              <Text
                className='gsl-card__name-text'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canQuickEdit || dragging) return
                  if (menuOpen) onToggleMenu()
                  onPickName(stop)
                }}
              >
                {stop.place.name}
              </Text>
            </View>
            <View
              className={`gsl-card__note${
                note ? '' : ' gsl-card__note--empty'
              }${canQuickEdit ? '' : ' gsl-card__note--readonly'}`}
            >
              <Text
                className='gsl-card__note-text'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canQuickEdit || dragging) return
                  if (menuOpen) onToggleMenu()
                  onPickNote(stop)
                }}
              >
                {note || '暂无备注'}
              </Text>
            </View>
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
  onPickName?: (stop: TripStopView) => void
  onPickNote?: (stop: TripStopView) => void
  onStopUpdated?: () => void
  onRemoveDay?: () => void
  /** 到达关键节点的路径距离 / 耗时（toStopId → leg） */
  routeLegByToStopId?: Record<
    string,
    { distanceMeters: number; durationSeconds?: number }
  >
  /** sheet 顶部时才允许点名称 / 备注快速编辑 */
  quickEditEnabled?: boolean
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
  onPickName,
  onPickNote,
  onStopUpdated,
  onRemoveDay,
  routeLegByToStopId,
  quickEditEnabled = true,
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
              [
                s.id,
                s.note || '',
                s.time || '',
                s.isKeyNode ? '1' : '0',
                s.travelMode || '',
                routeLegByToStopId?.[s.id]?.distanceMeters ?? '',
                routeLegByToStopId?.[s.id]?.durationSeconds ?? '',
                quickEditEnabled ? '1' : '0',
                s.dayIndex,
                s.place.name,
                s.place.typecode || '',
                s.place.type || '',
              ].join(':'),
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
        renderItem={(stop, { dragging }) => {
          const idx = dayStops.findIndex((s) => s.id === stop.id)
          const index = Math.max(1, idx + 1)
          // 关键节点导航起点：前一个关键点；若无则用当日第一点
          let prevStop: TripStopView | null = null
          if (idx > 0) {
            for (let i = idx - 1; i >= 0; i--) {
              if (dayStops[i]?.isKeyNode) {
                prevStop = dayStops[i]!
                break
              }
            }
            if (!prevStop) prevStop = dayStops[0] || null
            if (prevStop?.id === stop.id) prevStop = null
          }
          return (
            <TripStopCard
              stop={stop}
              prevStop={prevStop}
              index={index}
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
              onPickName={(s) => {
                setMenuId(null)
                onPickName?.(s)
              }}
              onPickNote={(s) => {
                setMenuId(null)
                onPickNote?.(s)
              }}
              onStopUpdated={onStopUpdated}
              routeLegByToStopId={routeLegByToStopId}
              quickEditEnabled={quickEditEnabled}
            />
          )
        }}
      />
    </View>
  )
}

export type TripNameEditSheetProps = {
  open: boolean
  stop: TripStopView | null
  onClose: () => void
  onSaved: () => void
}

/** 卡片名称：上浮框快速编辑 */
export function TripNameEditSheet({
  open,
  stop,
  onClose,
  onSaved,
}: TripNameEditSheetProps) {
  const { mounted, shown } = useDropdownAnim(open)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [inputFocus, setInputFocus] = useState(false)
  const keyboardHeight = useKeyboardHeight(open && shown)

  useEffect(() => {
    if (open && stop) {
      setDraft(stop.place.name || '')
      setSaving(false)
    }
    if (!open) {
      setDraft('')
      setSaving(false)
      setInputFocus(false)
    }
  }, [open, stop])

  useEffect(() => {
    if (!shown) {
      setInputFocus(false)
      return
    }
    const timer = setTimeout(() => setInputFocus(true), 300)
    return () => clearTimeout(timer)
  }, [shown])

  if (!mounted || !stop) return null

  const save = () => {
    if (saving) return
    const next = draft.trim()
    if (!next) {
      Taro.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    const prev = stop.place.name?.trim() || ''
    if (next === prev) {
      onClose()
      return
    }
    setSaving(true)
    const updated = updatePlaceInfo(stop.placeId, { name: next })
    setSaving(false)
    if (!updated) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    onSaved()
  }

  return (
    <View
      className={`trip-stop-edit${shown ? ' trip-stop-edit--open' : ''}`}
      catchMove
    >
      <View className='trip-stop-edit__mask' onClick={onClose} />
      <View
        className='trip-stop-edit__panel'
        style={{
          bottom: keyboardHeight,
          paddingBottom: keyboardHeight > 0 ? 8 : undefined,
        }}
      >
        <View className='trip-stop-edit__head'>
          <Text className='trip-stop-edit__title'>名称</Text>
          <Text className='trip-stop-edit__close' onClick={onClose}>
            关闭
          </Text>
        </View>
        <View className='trip-stop-edit__body trip-stop-edit__body--note'>
          <View className='card-edit'>
            <View className='card-edit__field'>
              <Input
                className='card-edit__input'
                value={draft}
                placeholder='地点名称'
                maxlength={40}
                focus={inputFocus}
                adjustPosition={false}
                holdKeyboard
                confirmType='done'
                onInput={(e) => setDraft(e.detail.value)}
                onConfirm={save}
              />
            </View>
          </View>
        </View>
        <View className='trip-stop-edit__foot'>
          <View className='trip-stop-edit__btn' onClick={onClose}>
            取消
          </View>
          <View
            className={`trip-stop-edit__btn trip-stop-edit__btn--primary${
              saving ? ' trip-stop-edit__btn--disabled' : ''
            }`}
            onClick={save}
          >
            保存
          </View>
        </View>
      </View>
    </View>
  )
}

export type TripNoteEditSheetProps = {
  open: boolean
  stop: TripStopView | null
  onClose: () => void
  onSaved: () => void
}

/** 卡片备注：上浮框快速编辑 */
export function TripNoteEditSheet({
  open,
  stop,
  onClose,
  onSaved,
}: TripNoteEditSheetProps) {
  const { mounted, shown } = useDropdownAnim(open)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [inputFocus, setInputFocus] = useState(false)
  const keyboardHeight = useKeyboardHeight(open && shown)

  useEffect(() => {
    if (open && stop) {
      setDraft(stop.note || '')
      setSaving(false)
    }
    if (!open) {
      setDraft('')
      setSaving(false)
      setInputFocus(false)
    }
  }, [open, stop])

  useEffect(() => {
    if (!shown) {
      setInputFocus(false)
      return
    }
    // 等弹层动画结束再聚焦，减少与键盘同时抢布局
    const timer = setTimeout(() => setInputFocus(true), 300)
    return () => clearTimeout(timer)
  }, [shown])

  if (!mounted || !stop) return null

  const save = () => {
    if (saving) return
    const next = draft.trim()
    const prev = stop.note?.trim() || ''
    if (next === prev) {
      onClose()
      return
    }
    setSaving(true)
    const updated = updateStopSchedule(stop.id, { note: next || null })
    setSaving(false)
    if (!updated) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    onSaved()
  }

  return (
    <View
      className={`trip-stop-edit${shown ? ' trip-stop-edit--open' : ''}`}
      catchMove
    >
      <View className='trip-stop-edit__mask' onClick={onClose} />
      <View
        className='trip-stop-edit__panel'
        style={{
          bottom: keyboardHeight,
          paddingBottom:
            keyboardHeight > 0 ? 8 : undefined,
        }}
      >
        <View className='trip-stop-edit__head'>
          <Text className='trip-stop-edit__title'>备注</Text>
          <Text className='trip-stop-edit__close' onClick={onClose}>
            关闭
          </Text>
        </View>
        <View className='trip-stop-edit__body trip-stop-edit__body--note'>
          <View className='card-edit'>
            <View className='card-edit__field'>
              <Textarea
                className='card-edit__textarea'
                value={draft}
                placeholder='添加备注'
                maxlength={200}
                autoHeight
                focus={inputFocus}
                showConfirmBar={false}
                adjustPosition={false}
                holdKeyboard
                onInput={(e) => setDraft(e.detail.value)}
              />
            </View>
          </View>
        </View>
        <View className='trip-stop-edit__foot'>
          <View className='trip-stop-edit__btn' onClick={onClose}>
            取消
          </View>
          <View
            className={`trip-stop-edit__btn trip-stop-edit__btn--primary${
              saving ? ' trip-stop-edit__btn--disabled' : ''
            }`}
            onClick={save}
          >
            保存
          </View>
        </View>
      </View>
    </View>
  )
}

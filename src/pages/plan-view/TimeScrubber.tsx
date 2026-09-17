import { RichText, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Navigation } from 'lucide-react-taro/icons/navigation'
import { Star } from 'lucide-react-taro/icons/star'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { TargetPoint } from '../../types'
import { formatClock } from '../../utils/datetime'
import { placeInfoRows } from './place-info'
import {
  buildHourSlots,
  expectedAtForSlot,
  formatSlotClock,
  formatSlotLabel,
  slotIndexOf,
  slotMarks,
  slotPlaceNames,
  stickyMarkTop,
  tickOffset,
  tickSpacing,
  type HourSlot,
  type SlotMark,
} from './time-scrub'

export type CardOrigin = {
  top: number
  left: number
  width: number
  height: number
}

const HOUR_H = 64
const TICK_MS = 16
/** 滑完整条时间轴所需的行程，占屏幕高度的比例。刻度均匀，与起止位置无关 */
const DRAG_REACH = 0.26

function StickyMarks({
  marks,
  stickY,
  scrollIndex,
  centerY,
  half,
  textClass,
}: {
  marks: SlotMark[]
  stickY: number
  scrollIndex: number
  centerY: number
  half: number
  textClass: string
}) {
  return (
    <>
      {marks.map((mark, markIndex) => {
        const next = marks[markIndex + 1]
        const top = stickyMarkTop(
          mark.start,
          next ? next.start : null,
          scrollIndex,
          centerY,
          half,
          HOUR_H,
        )
        if (top > stickY + 1 || top < -HOUR_H * 2) return null
        const leaving = stickY - top
        const opacity = leaving <= 0 ? 1 : Math.max(0, 1 - leaving / (HOUR_H * 2.2))
        return (
          <View
            key={`${mark.label}-${mark.start}`}
            className='time-scrub__mark'
            style={{ top: `${top}px`, height: `${HOUR_H}px`, opacity }}
          >
            <Text className={textClass}>{mark.label}</Text>
          </View>
        )
      })}
    </>
  )
}

function HourRows({
  slots,
  names,
  scrollIndex,
  windowHeight,
}: {
  slots: HourSlot[]
  names: string[]
  scrollIndex: number
  windowHeight: number
}) {
  const half = windowHeight / 2
  const from = Math.max(0, Math.floor(scrollIndex - 18))
  const to = Math.min(slots.length, Math.ceil(scrollIndex + 18))
  const rows = []
  for (let slotIndex = from; slotIndex < to; slotIndex += 1) {
    const slot = slots[slotIndex]
    const delta = slotIndex - scrollIndex
    const space = tickSpacing(delta, HOUR_H, half)
    const center = half + tickOffset(delta, HOUR_H, half)
    const scale = Math.max(0.42, Math.min(1.16, space / HOUR_H))
    const opacity = Math.max(0, Math.min(1, (space - 5) / 20))
    rows.push(
      <View
        key={`${slot.year}-${slot.month}-${slot.date}-${slot.hour}`}
        className={`time-scrub__row${Math.abs(delta) < 0.5 ? ' time-scrub__row--active' : ''}`}
        style={{
          position: 'absolute',
          top: `${center - space / 2}px`,
          left: 0,
          right: 0,
          height: `${Math.max(space, 12)}px`,
          opacity,
        }}
      >
        <View
          className='time-scrub__label'
          style={{ transform: `scale(${scale})`, transformOrigin: 'left center' }}
        >
          <Text className='time-scrub__hour'>{formatSlotClock(slot)}</Text>
          {names[slotIndex] ? (
            <Text className='time-scrub__place'>{names[slotIndex]}</Text>
          ) : null}
        </View>
      </View>,
    )
  }
  return <>{rows}</>
}

export type TimeScrubberHandle = {
  release: () => void
}

type TimeScrubberProps = {
  point: TargetPoint
  points: TargetPoint[]
  origin: CardOrigin
  startFingerY: number
  expanded: boolean
  collected: boolean
  fingerYRef: { current: number }
  onConfirm: (expectedAt: string) => void
  onCancel: () => void
}

export const TimeScrubber = forwardRef<TimeScrubberHandle, TimeScrubberProps>(
  function TimeScrubber(
    { point, points, origin, startFingerY, expanded, collected, fingerYRef, onConfirm, onCancel },
    ref,
  ) {
    const slots = useMemo(() => buildHourSlots(points), [points])
    const marks = useMemo(() => slotMarks(slots), [slots])
    const names = useMemo(() => slotPlaceNames(slots, points), [slots, points])
    const [windowHeight, setWindowHeight] = useState(667)
    const startIndex = slotIndexOf(slots, point.expectedAt)
    const [index, setIndex] = useState(startIndex)
    const [scrollIndex, setScrollIndex] = useState(startIndex)
    const [cardTop, setCardTop] = useState(origin.top)
    const indexRef = useRef(startIndex)
    const scrollRef = useRef(startIndex)
    const releasedRef = useRef(false)
    const mountedRef = useRef(true)
    const layoutRef = useRef({ height: 667 })
    const confirmRef = useRef(onConfirm)
    const cancelRef = useRef(onCancel)
    confirmRef.current = onConfirm
    cancelRef.current = onCancel

    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
      }
    }, [])

    useEffect(() => {
      const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
      const height = info.windowHeight || 667
      layoutRef.current = { height }
      setWindowHeight(height)
    }, [])

    const targetIndex = (fingerY: number) => {
      const dy = fingerY - startFingerY
      const { height } = layoutRef.current
      const travel = Math.max(1, height * DRAG_REACH)
      const perPx = slots.length <= 1 ? 0 : (slots.length - 1) / travel
      const next = startIndex + dy * perPx
      return Math.min(slots.length - 1, Math.max(0, next))
    }

    const publishScroll = (value: number) => {
      scrollRef.current = value
      setScrollIndex(value)
      const rounded = Math.min(slots.length - 1, Math.max(0, Math.round(value)))
      if (rounded === indexRef.current) return
      indexRef.current = rounded
      setIndex(rounded)
    }

    useEffect(() => {
      let last = Date.now()
      const timer = setInterval(() => {
        if (releasedRef.current || slots.length === 0) return
        const now = Date.now()
        const dt = Math.min(48, Math.max(8, now - last))
        last = now
        const target = targetIndex(fingerYRef.current)
        const current = scrollRef.current
        const factor = 1 - Math.exp(-dt / 42)
        const next = Math.abs(target - current) < 0.004 ? target : current + (target - current) * factor
        publishScroll(next)
        setCardTop(origin.top + fingerYRef.current - startFingerY)
      }, TICK_MS)
      return () => clearInterval(timer)
    }, [fingerYRef, origin.top, slots.length, startFingerY, startIndex])

    const release = () => {
      if (releasedRef.current) return
      releasedRef.current = true
      const target = Math.min(slots.length - 1, Math.max(0, Math.round(scrollRef.current)))
      const from = scrollRef.current
      const finish = () => {
        const slot = slots[target]
        if (!slot) {
          cancelRef.current()
          return
        }
        Taro.showModal({
          title: '设置时间',
          content: `将「${point.place.name}」设为 ${formatSlotLabel(slot)}？`,
          confirmText: '保存',
          cancelText: '取消',
          confirmColor: '#1a5f4a',
        }).then(({ confirm }) => {
          if (confirm) confirmRef.current(expectedAtForSlot(slot, points, point.id))
          else cancelRef.current()
        })
      }
      if (Math.abs(from - target) < 0.02) {
        publishScroll(target)
        finish()
        return
      }
      const t0 = Date.now()
      const step = () => {
        if (!mountedRef.current) return
        const p = Math.min(1, (Date.now() - t0) / 180)
        const ease = 1 - (1 - p) ** 3
        publishScroll(from + (target - from) * ease)
        if (p < 1) setTimeout(step, TICK_MS)
        else finish()
      }
      step()
    }

    useImperativeHandle(ref, () => ({ release }), [point.id, point.place.name, points, slots])

    if (slots.length === 0) return null

    const centerY = windowHeight / 2
    const active = slots[index]
    const dateStick = centerY - 1.5 * HOUR_H

    return (
      <View
        className='time-scrub'
        catchMove
        onTouchMove={(e) => {
          const t = e.touches[0]
          if (t) fingerYRef.current = t.clientY
        }}
        onTouchEnd={release}
      >
        <View className='time-scrub__pointer' style={{ top: `${centerY - HOUR_H / 2}px`, height: `${HOUR_H}px` }} />
        <View className='time-scrub__axis'>
          <View className='time-scrub__rail' />
          <HourRows slots={slots} names={names} scrollIndex={scrollIndex} windowHeight={windowHeight} />
          <StickyMarks
            marks={marks}
            stickY={dateStick}
            scrollIndex={scrollIndex}
            centerY={centerY}
            half={centerY}
            textClass='time-scrub__date'
          />
          <View className='time-scrub__fade time-scrub__fade--top' />
          <View className='time-scrub__fade time-scrub__fade--bottom' />
        </View>
        <View
          className={`timeline__card time-scrub__float${expanded ? ' timeline__card--open' : ''}`}
          style={{
            top: `${cardTop}px`,
            left: `${origin.left}px`,
            width: `${origin.width}px`,
            height: `${origin.height}px`,
          }}
        >
          <View className='timeline__head'>
            <View className='timeline__main'>
              <View className='timeline__time'>
                {active && index !== startIndex
                  ? `${active.hour}:00`
                  : formatClock(point.expectedAt)}
              </View>
              <View className='timeline__name'>{point.place.name}</View>
              {!!point.place.address && (
                <View className='timeline__addr'>{point.place.address}</View>
              )}
            </View>
            <View className='timeline__nav'>
              <Navigation size={16} color='#1a5f4a' />
            </View>
            <View className='collect-star'>
              <Star size={18} color='#eab308' filled={collected} />
            </View>
          </View>
          {expanded ? (
            <View className='timeline__detail'>
              <View className='timeline__detail-inner'>
                {placeInfoRows(point.place).map((row) => (
                  <View key={row.label} className='timeline__info-row'>
                    <View className='timeline__info-label'>{row.label}</View>
                    <View className='timeline__info-value'>{row.value}</View>
                  </View>
                ))}
                <View className='timeline__detail-divider' />
                {point.noteHtml?.trim() ? (
                  <RichText className='timeline__detail-html' nodes={point.noteHtml} />
                ) : point.noteText?.trim() ? (
                  <View className='timeline__detail-text'>{point.noteText}</View>
                ) : (
                  <View className='timeline__detail-empty'>暂无备注</View>
                )}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    )
  },
)

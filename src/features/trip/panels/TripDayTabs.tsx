import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { TripDay } from '../trip-days'

export type TripDayTabsProps = {
  days: TripDay[]
  dayKey: string
  onSelect: (dayKey: string) => void
  /** 末尾虚线卡片：待创建的下一日期 */
  nextDay?: { label: string; weekday: string }
  onAddDay?: () => void
  /** 长按拖动排序：fromIndex → toIndex（均为 days 下标） */
  onReorder?: (fromIndex: number, toIndex: number) => void
}

const LONG_PRESS_MS = 320
const MOVE_THRESHOLD = 8
const EDGE_PX = 40

type ItemGeom = { left: number; top: number; width: number; center: number }

function pageQuery() {
  const page = Taro.getCurrentInstance().page
  return page ? Taro.createSelectorQuery().in(page) : Taro.createSelectorQuery()
}

function touchClientXY(e: unknown): { x: number; y: number } | null {
  const t = (e as {
    touches?: Array<{ clientX?: number; clientY?: number }>
  })?.touches?.[0]
  const x = t?.clientX
  const y = t?.clientY
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  return { x, y }
}

function insertIndexFromX(
  clientX: number,
  geoms: ItemGeom[],
  fromIndex: number,
): number {
  if (geoms.length === 0) return fromIndex
  let idx = geoms.length - 1
  for (let i = 0; i < geoms.length; i += 1) {
    if (clientX < geoms[i].center) {
      idx = i
      break
    }
  }
  return idx
}

function shiftForIndex(
  index: number,
  from: number,
  insert: number,
  step: number,
): number {
  if (index === from) return 0
  if (from < insert) {
    if (index > from && index <= insert) return -step
  } else if (from > insert) {
    if (index >= insert && index < from) return step
  }
  return 0
}

/** 行程编辑：按日横向切换，支持长按拖动排序 */
export function TripDayTabs({
  days,
  dayKey,
  onSelect,
  nextDay,
  onAddDay,
  onReorder,
}: TripDayTabsProps) {
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrollLeftRef = useRef(0)
  const scrollSeq = useRef(0)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [floatX, setFloatX] = useState<number | null>(null)
  const [floatTop, setFloatTop] = useState(0)
  const [floatW, setFloatW] = useState(0)
  const [itemStep, setItemStep] = useState(0)
  const [hasMoved, setHasMoved] = useState(false)

  const dragIndexRef = useRef<number | null>(null)
  const insertIndexRef = useRef<number | null>(null)
  const hasMovedRef = useRef(false)
  const ignoreClickRef = useRef(false)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStartXRef = useRef(0)
  const pressStartYRef = useRef(0)
  const grabOffsetRef = useRef(0)
  const floatXRef = useRef<number | null>(null)
  const geomsRef = useRef<ItemGeom[]>([])
  const viewportRef = useRef({ left: 0, width: 0 })
  const itemStepRef = useRef(0)
  const daysLenRef = useRef(days.length)
  const onReorderRef = useRef(onReorder)
  const onSelectRef = useRef(onSelect)
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rowWidthRef = useRef(0)

  daysLenRef.current = days.length
  onReorderRef.current = onReorder
  onSelectRef.current = onSelect

  const dragging = dragIndex != null

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  const stopAutoScroll = () => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }

  const measure = (cb: (geoms: ItemGeom[]) => void) => {
    const query = pageQuery()
    query.select('.trip-days').boundingClientRect()
    query.select('.trip-days').scrollOffset()
    query.selectAll('.trip-days__item--day').boundingClientRect()
    query.select('.trip-days__row').boundingClientRect()
    query.exec((res) => {
      const viewport = res?.[0] as
        | { left?: number; width?: number }
        | undefined
      const scroll = res?.[1] as { scrollLeft?: number } | undefined
      const items = (res?.[2] || []) as Array<{
        left?: number
        top?: number
        width?: number
      }>
      const row = res?.[3] as { width?: number } | undefined
      if (!viewport?.width || viewport.left == null || !items.length) {
        cb([])
        return
      }
      if (scroll?.scrollLeft != null) {
        scrollLeftRef.current = scroll.scrollLeft
      }
      viewportRef.current = {
        left: viewport.left,
        width: viewport.width,
      }
      rowWidthRef.current = row?.width || 0
      const geoms: ItemGeom[] = items.map((it) => {
        const left = it.left ?? 0
        const width = it.width ?? 0
        return {
          left,
          top: it.top ?? 0,
          width,
          center: left + width / 2,
        }
      })
      geomsRef.current = geoms
      if (geoms.length >= 2) {
        const step = geoms[1].left - geoms[0].left
        itemStepRef.current = step > 0 ? step : geoms[0].width
        setItemStep(itemStepRef.current)
      } else if (geoms[0]) {
        itemStepRef.current = geoms[0].width
        setItemStep(geoms[0].width)
      }
      cb(geoms)
    })
  }

  const armIgnoreClick = () => {
    ignoreClickRef.current = true
    setTimeout(() => {
      ignoreClickRef.current = false
    }, 280)
  }

  const endDrag = () => {
    clearPressTimer()
    stopAutoScroll()
    const from = dragIndexRef.current
    const to = insertIndexRef.current
    const moved = hasMovedRef.current
    dragIndexRef.current = null
    insertIndexRef.current = null
    hasMovedRef.current = false
    floatXRef.current = null
    setDragIndex(null)
    setInsertIndex(null)
    setFloatX(null)
    setHasMoved(false)
    armIgnoreClick()
    if (from == null || to == null || !moved || from === to) return
    onReorderRef.current?.(from, to)
  }

  /** 取消排序拖拽（不提交）；用于上下滑等手势冲突 */
  const cancelDrag = () => {
    clearPressTimer()
    stopAutoScroll()
    dragIndexRef.current = null
    insertIndexRef.current = null
    hasMovedRef.current = false
    floatXRef.current = null
    setDragIndex(null)
    setInsertIndex(null)
    setFloatX(null)
    setHasMoved(false)
    armIgnoreClick()
  }

  const ensureEdgeScroll = (clientX: number) => {
    const { left, width } = viewportRef.current
    if (!width) {
      stopAutoScroll()
      return
    }
    let dir = 0
    if (clientX < left + EDGE_PX) dir = -1
    else if (clientX > left + width - EDGE_PX) dir = 1
    if (dir === 0) {
      stopAutoScroll()
      return
    }
    if (autoScrollRef.current) return
    autoScrollRef.current = setInterval(() => {
      if (dragIndexRef.current == null) {
        stopAutoScroll()
        return
      }
      const maxScroll = Math.max(
        0,
        rowWidthRef.current - viewportRef.current.width,
      )
      const next = Math.min(
        maxScroll,
        Math.max(0, scrollLeftRef.current + dir * 12),
      )
      if (next === scrollLeftRef.current) {
        stopAutoScroll()
        return
      }
      scrollLeftRef.current = next
      setScrollLeft(next)
      measure((geoms) => {
        const fx = floatXRef.current
        if (fx == null || !geoms.length) return
        const insert = insertIndexFromX(fx, geoms, dragIndexRef.current!)
        insertIndexRef.current = insert
        setInsertIndex(insert)
      })
    }, 16)
  }

  const startDrag = (index: number, clientX: number) => {
    if (!onReorderRef.current || daysLenRef.current < 2) return
    measure((geoms) => {
      const geom = geoms[index]
      if (!geom) return
      grabOffsetRef.current = clientX - geom.left
      dragIndexRef.current = index
      insertIndexRef.current = index
      hasMovedRef.current = false
      floatXRef.current = geom.left
      setDragIndex(index)
      setInsertIndex(index)
      setFloatX(geom.left)
      setFloatTop(geom.top)
      setFloatW(geom.width)
      setHasMoved(false)
    })
  }

  const onItemTouchStart = (index: number, e: unknown) => {
    if (!onReorder || days.length < 2) return
    const pt = touchClientXY(e)
    if (!pt) return
    clearPressTimer()
    pressStartXRef.current = pt.x
    pressStartYRef.current = pt.y
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null
      startDrag(index, pt.x)
    }, LONG_PRESS_MS)
  }

  const onItemTouchMove = (e: unknown) => {
    const pt = touchClientXY(e)
    if (!pt) return
    const dx = pt.x - pressStartXRef.current
    const dy = pt.y - pressStartYRef.current

    if (dragIndexRef.current == null) {
      // 任意方向滑动都取消长按，避免上下拖 sheet 触发排序
      if (
        pressTimerRef.current &&
        (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD)
      ) {
        clearPressTimer()
      }
      return
    }

    // 已进入长按态但尚未横向挪动：纵向为主则放弃排序
    if (!hasMovedRef.current) {
      if (
        Math.abs(dy) > MOVE_THRESHOLD &&
        Math.abs(dy) >= Math.abs(dx)
      ) {
        cancelDrag()
        return
      }
      if (Math.abs(dx) <= MOVE_THRESHOLD) return
    }

    const left = pt.x - grabOffsetRef.current
    floatXRef.current = left
    setFloatX(left)
    if (!hasMovedRef.current) {
      hasMovedRef.current = true
      setHasMoved(true)
    }

    const geoms = geomsRef.current
    if (geoms.length) {
      const insert = insertIndexFromX(
        left + (geoms[dragIndexRef.current]?.width || 0) / 2,
        geoms,
        dragIndexRef.current,
      )
      if (insert !== insertIndexRef.current) {
        insertIndexRef.current = insert
        setInsertIndex(insert)
      }
    }
    ensureEdgeScroll(pt.x)
  }

  const onItemTouchEnd = () => {
    if (dragIndexRef.current != null) {
      endDrag()
      return
    }
    clearPressTimer()
  }

  useEffect(() => {
    if (!dayKey || dragging) return
    const seq = ++scrollSeq.current
    Taro.nextTick(() => {
      const query = pageQuery()
      query.select('.trip-days').boundingClientRect()
      query.select('.trip-days').scrollOffset()
      query.select(`#trip-day-${dayKey}`).boundingClientRect()
      query.select('.trip-days__row').boundingClientRect()
      query.exec((res) => {
        if (seq !== scrollSeq.current) return
        const viewport = res?.[0] as
          | { left?: number; width?: number }
          | undefined
        const scroll = res?.[1] as { scrollLeft?: number } | undefined
        const item = res?.[2] as
          | { left?: number; width?: number }
          | undefined
        const row = res?.[3] as { width?: number } | undefined
        if (
          !viewport?.width ||
          !item?.width ||
          viewport.left == null ||
          item.left == null ||
          !row?.width
        ) {
          return
        }
        const currentLeft = scroll?.scrollLeft ?? scrollLeftRef.current
        const itemOffset = currentLeft + (item.left - viewport.left)
        const ideal = itemOffset + item.width / 2 - viewport.width / 2
        const maxScroll = Math.max(0, row.width - viewport.width)
        const next = Math.min(maxScroll, Math.max(0, ideal))
        if (Math.abs(next - currentLeft) < 1) return
        scrollLeftRef.current = next
        setScrollLeft(next)
      })
    })
  }, [dayKey, dragging])

  useEffect(
    () => () => {
      clearPressTimer()
      stopAutoScroll()
    },
    [],
  )

  const activeDay =
    dragIndex != null && dragIndex >= 0 && dragIndex < days.length
      ? days[dragIndex]
      : null
  const step = itemStep || 0

  return (
    <View className={`trip-days-wrap${dragging ? ' trip-days-wrap--drag' : ''}`}>
      <ScrollView
        scrollX={!dragging}
        className='trip-days'
        enhanced
        showScrollbar={false}
        scrollLeft={scrollLeft}
        scrollWithAnimation={!dragging}
        onScroll={(e) => {
          if (dragging) return
          const left = e.detail.scrollLeft
          if (left == null || !Number.isFinite(left)) return
          scrollLeftRef.current = left
        }}
      >
        <View className='trip-days__row'>
          {days.map((day, index) => {
            const key = String(day.dayIndex)
            const active = key === dayKey
            const isDrag = dragIndex === index
            const shift =
              dragIndex != null && insertIndex != null && hasMoved
                ? shiftForIndex(index, dragIndex, insertIndex, step)
                : 0
            return (
              <View
                id={`trip-day-${key}`}
                key={key}
                className={`trip-days__item trip-days__item--day${
                  active ? ' trip-days__item--on' : ''
                }${isDrag && hasMoved ? ' trip-days__item--ghost' : ''}`}
                style={
                  shift
                    ? {
                        transform: `translate3d(${shift}px, 0, 0)`,
                        transition: 'transform 0.16s ease',
                      }
                    : dragging
                      ? { transition: 'transform 0.16s ease' }
                      : undefined
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (ignoreClickRef.current || dragging) return
                  onSelectRef.current(key)
                }}
                onTouchStart={(e) => onItemTouchStart(index, e)}
                onTouchMove={onItemTouchMove}
                onTouchEnd={onItemTouchEnd}
                onTouchCancel={onItemTouchEnd}
              >
                <Text className='trip-days__label'>{day.label}</Text>
                <Text className='trip-days__week'>{day.weekday}</Text>
              </View>
            )
          })}
          {nextDay && onAddDay ? (
            <View
              className='trip-days__item trip-days__item--add'
              onClick={(e) => {
                e.stopPropagation()
                if (dragging) return
                onAddDay()
              }}
            >
              <Text className='trip-days__label'>{nextDay.label}</Text>
              <Text className='trip-days__week'>{nextDay.weekday}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {dragging && activeDay && floatX != null ? (
        <View
          className='trip-days__float'
          catchMove
          style={{
            left: `${floatX}px`,
            top: `${floatTop}px`,
            width: floatW > 0 ? `${floatW}px` : undefined,
          }}
          onTouchMove={onItemTouchMove}
          onTouchEnd={onItemTouchEnd}
          onTouchCancel={onItemTouchEnd}
        >
          <View
            className={`trip-days__item trip-days__item--on trip-days__item--float${
              hasMoved ? ' trip-days__item--float-on' : ''
            }`}
          >
            <Text className='trip-days__label'>{activeDay.label}</Text>
            <Text className='trip-days__week'>{activeDay.weekday}</Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

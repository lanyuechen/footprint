import { View, ScrollView, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import './GroupedSortList.scss'

/**
 * 分组拖拽排序（长按 → 浮层跟手 + 其余项 translateY 让位
 * → 贴边虚拟滚动 → 松手提交顺序）
 *
 * 空闲时不 catchMove，把滚动交给原生 scroll-view；
 * 长按进入拖拽后用全屏遮罩 catchMove，避免点卡片滚动卡顿。
 */

export type SortGroup<T extends { id: string }> = {
  id: string
  title: string
  subtitle?: string
  items: T[]
}

export type GroupedSortListProps<T extends { id: string }> = {
  groups: SortGroup<T>[]
  /** 未测到高度时的回退值（屏幕 px） */
  itemHeight?: number
  headerHeight?: number
  renderItem: (
    item: T,
    ctx: { dragging: boolean; isLast: boolean; isFirstInGroup: boolean },
  ) => React.ReactNode
  renderHeader?: (
    group: SortGroup<T>,
    ctx: { dragging: boolean; isFirst: boolean },
  ) => React.ReactNode
  onChange: (groups: SortGroup<T>[]) => void
  /** 内容高度变化时传入（如展开详情），触发重新测高 */
  layoutKey?: string | number
  /** 点击条目（非拖拽） */
  onItemClick?: (id: string) => void
  /** 开始拖拽（用于收起展开等） */
  onDragStart?: (id: string) => void
  headerSlot?: React.ReactNode
  /** 列表末尾固定节点（不参与排序） */
  footerSlot?: React.ReactNode
  /** footer 高度（屏幕 px），有 footerSlot 时生效 */
  footerHeight?: number
}

type LayoutItem<T> = {
  id: string
  groupId: string
  data: T
  baseY: number
  height: number
  isLast: boolean
  isFirstInGroup: boolean
}

type LayoutHeader = {
  groupId: string
  title: string
  subtitle?: string
  y: number
  isFirst: boolean
}

const MOVE_THRESHOLD = 10
const CANCEL_MOVE_PX = 8
const MEASURE_RETRY_MS = [50, 100, 160, 220, 280, 360, 420]

function rpx2px(rpx: number) {
  try {
    const w = Taro.getWindowInfo?.().windowWidth || Taro.getSystemInfoSync().windowWidth
    return (w / 750) * rpx
  } catch {
    return rpx * 0.5
  }
}

function heightOf(id: string, heights: Record<string, number>, fallback: number) {
  return heights[id] && heights[id] > 0 ? heights[id] : fallback
}

/** 微信 scroll-view：相同 scrollTop 不刷新，加微小扰动强制生效 */
function nudgeScroll(top: number) {
  return top + (Date.now() % 2) * 0.01
}

function pageQuery() {
  const page = Taro.getCurrentInstance().page
  return page ? Taro.createSelectorQuery().in(page) : Taro.createSelectorQuery()
}

/** 拖动卡片中心越过另一卡片中心时，才切换插入位置 */
function reorderGroups<T extends { id: string }>(
  groups: SortGroup<T>[],
  activeId: string,
  activeY: number,
  activeH: number,
  heights: Record<string, number>,
  fallbackH: number,
  headerH: number,
): SortGroup<T>[] {
  let activeData: T | null = null
  const activeCenter = activeY + activeH / 2

  type Other = { groupId: string; data: T; center: number }
  const others: Other[] = []
  type GroupRange = { groupId: string; start: number; end: number }
  const ranges: GroupRange[] = []

  let y = 0
  for (const g of groups) {
    const start = y
    y += headerH
    for (const data of g.items) {
      const h = heightOf(data.id, heights, fallbackH)
      if (data.id === activeId) {
        activeData = data
      } else {
        others.push({ groupId: g.id, data, center: y + h / 2 })
      }
      y += h
    }
    ranges.push({ groupId: g.id, start, end: y })
  }
  if (!activeData) return groups

  let targetGroupId = ranges[0]?.groupId || ''
  for (const r of ranges) {
    if (activeCenter >= r.start) targetGroupId = r.groupId
  }

  const groupOthers = others.filter((o) => o.groupId === targetGroupId)
  let targetIndex = groupOthers.length
  for (let i = 0; i < groupOthers.length; i += 1) {
    if (activeCenter < groupOthers[i].center) {
      targetIndex = i
      break
    }
  }

  const rest = groups.map((g) => ({
    ...g,
    items: g.items.filter((it) => it.id !== activeId),
  }))

  return rest.map((g) => {
    if (g.id !== targetGroupId) return g
    const items = [...g.items]
    items.splice(
      Math.max(0, Math.min(targetIndex, items.length)),
      0,
      activeData as T,
    )
    return { ...g, items }
  })
}

function layoutGroups<T extends { id: string }>(
  groups: SortGroup<T>[],
  heights: Record<string, number>,
  fallbackH: number,
  headerH: number,
): { headers: LayoutHeader[]; items: LayoutItem<T>[]; areaH: number } {
  const headers: LayoutHeader[] = []
  const items: LayoutItem<T>[] = []
  let y = 0
  const flatCount = groups.reduce((n, g) => n + g.items.length, 0)
  let flatIndex = 0
  groups.forEach((g, gi) => {
    headers.push({
      groupId: g.id,
      title: g.title,
      subtitle: g.subtitle,
      y,
      isFirst: gi === 0,
    })
    y += headerH
    g.items.forEach((data, ii) => {
      const height = heightOf(data.id, heights, fallbackH)
      items.push({
        id: data.id,
        groupId: g.id,
        data,
        baseY: y,
        height,
        isLast: flatIndex === flatCount - 1,
        isFirstInGroup: ii === 0,
      })
      flatIndex += 1
      y += height
    })
  })
  return { headers, items, areaH: Math.max(y, headerH) }
}

function isSameStructure<T extends { id: string }>(
  a: SortGroup<T>[],
  b: SortGroup<T>[],
) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false
    if (a[i].items.length !== b[i].items.length) return false
    for (let j = 0; j < a[i].items.length; j += 1) {
      if (a[i].items[j].id !== b[i].items[j].id) return false
    }
  }
  return true
}

export function GroupedSortList<T extends { id: string }>(
  props: GroupedSortListProps<T>,
) {
  const fallbackH = props.itemHeight ?? Math.round(rpx2px(168))
  const headerH = props.headerHeight ?? Math.round(rpx2px(88))
  const footerH = props.footerSlot
    ? props.footerHeight ?? Math.round(rpx2px(88))
    : 0

  // —— 渲染态 ——
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeY, setActiveY] = useState<number | null>(null)
  const [originY, setOriginY] = useState<number | null>(null)
  const [hasMoved, setHasMoved] = useState(false)
  /** 非 null 时锁定原生 scrollTop，改用 contentShift 虚拟滚 */
  const [dragLockScroll, setDragLockScroll] = useState<number | null>(null)
  const [contentShift, setContentShift] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [heights, setHeights] = useState<Record<string, number>>({})
  /** 进入页时从底部依次上升，仅首屏播放一次 */
  const [enterAnim, setEnterAnim] = useState(true)
  /** 仅程序化改滚动时递增，避免滚动过程 setState 导致卡顿 */
  const [scrollApplyNonce, setScrollApplyNonce] = useState(0)

  // —— 触摸回调用的镜像（避免闭包过期）——
  const activeIdRef = useRef<string | null>(null)
  const activeYRef = useRef<number | null>(null)
  const originYRef = useRef<number | null>(null)
  const hasMovedRef = useRef(false)
  const scrollTopRef = useRef(0)
  const dragLockScrollRef = useRef<number | null>(null)
  const grabOffsetRef = useRef(0)
  const scrollRectTopRef = useRef(0)
  const areaHRef = useRef(0)
  const viewportHRef = useRef(600)
  const heightsRef = useRef(heights)
  const previewRef = useRef<SortGroup<T>[] | null>(null)
  /** 松手后钉住已提交顺序，直到 props.groups 跟上，避免闪回旧序 */
  const committedRef = useRef<SortGroup<T>[] | null>(null)
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoDirRef = useRef(0)
  const autoSpeedRef = useRef(12)
  const ignoreClickRef = useRef(false)
  const pressRef = useRef<{
    id: string
    baseY: number
    startX: number
    startY: number
    clientY: number
    moved: boolean
  } | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const pendingDragYRef = useRef<{ y: number; clientY?: number } | null>(null)
  const layoutByIdRef = useRef(new Map<string, LayoutItem<T>>())
  const onChangeRef = useRef(props.onChange)
  const onDragStartRef = useRef(props.onDragStart)
  onChangeRef.current = props.onChange
  onDragStartRef.current = props.onDragStart
  heightsRef.current = heights
  viewportHRef.current = viewportH

  const dragging = !!activeId

  const flushDragRaf = () => {
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    pendingDragYRef.current = null
  }

  const applyProgramScroll = (top: number) => {
    scrollTopRef.current = top
    setScrollApplyNonce((n) => n + 1)
  }

  // —— 布局：预览序 → 测高坐标 ——
  const flatIds = useMemo(
    () => props.groups.flatMap((g) => g.items.map((it) => it.id)).join('|'),
    [props.groups],
  )

  const displayGroups = useMemo(() => {
    if (committedRef.current) {
      if (isSameStructure(committedRef.current, props.groups)) {
        committedRef.current = null
        return props.groups
      }
      return committedRef.current
    }
    if (activeId == null || activeY == null || !hasMoved) {
      previewRef.current = null
      return props.groups
    }
    const activeH = heightOf(activeId, heights, fallbackH)
    const baseGroups = previewRef.current || props.groups
    const next = reorderGroups(
      baseGroups,
      activeId,
      activeY,
      activeH,
      heights,
      fallbackH,
      headerH,
    )
    const prev = previewRef.current
    if (prev && isSameStructure(prev, next)) return prev
    previewRef.current = next
    return next
  }, [props.groups, activeId, activeY, hasMoved, heights, fallbackH, headerH])

  const layout = useMemo(
    () => layoutGroups(displayGroups, heights, fallbackH, headerH),
    [displayGroups, heights, fallbackH, headerH],
  )
  const contentH = layout.areaH
  const totalAreaH = contentH + footerH
  areaHRef.current = totalAreaH
  layoutByIdRef.current = new Map(layout.items.map((it) => [it.id, it]))

  const pushTransition =
    dragging && hasMoved
      ? 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none'

  // 按 id 稳定渲染，松手后 props 重排时不闪 DOM
  const stableItems = useMemo(
    () =>
      [...layout.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [layout.items],
  )

  const activeLayoutItem = useMemo(
    () => layout.items.find((it) => it.id === activeId) || null,
    [layout.items, activeId],
  )

  const footerY = contentH
  const spineTop = headerH / 2
  const spineBottom = footerH
    ? footerY + footerH / 2
    : layout.items.length
      ? Math.max(...layout.items.map((it) => it.baseY + it.height / 2))
      : layout.headers.length
        ? layout.headers[layout.headers.length - 1].y + headerH / 2
        : spineTop
  const spineHeight = Math.max(0, spineBottom - spineTop)

  const riseDelayByKey = useMemo(() => {
    const nodes: Array<{ key: string; y: number }> = layout.headers.map((h) => ({
      key: `h-${h.groupId}`,
      y: h.y,
    }))
    layout.items.forEach((it) => {
      nodes.push({ key: `i-${it.id}`, y: it.baseY })
    })
    if (footerH) nodes.push({ key: 'footer', y: footerY })
    nodes.sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1))
    const map: Record<string, number> = {}
    nodes.forEach((n, i) => {
      map[n.key] = 80 + Math.min(i, 16) * 72
    })
    return map
  }, [layout.headers, layout.items, footerH, footerY])

  // —— 测高 / 视口 ——
  const measureScrollRect = () => {
    pageQuery()
      .select('#grouped-sort-scroll')
      .boundingClientRect()
      .exec((res) => {
        const rect = res?.[0]
        if (rect?.top != null) scrollRectTopRef.current = rect.top
        if (rect?.height) {
          setViewportH(rect.height)
          viewportHRef.current = rect.height
        }
      })
  }

  const measureHeights = () => {
    pageQuery()
      .selectAll('.gsl-measure')
      .fields({ dataset: true, id: true, rect: true, size: true })
      .exec((res) => {
        const nodes = (res?.[0] || []) as Array<{
          height?: number
          id?: string
          dataset?: { id?: string }
        }>
        if (!nodes.length) return
        // DOM 按 id 排序渲染；禁止用 props 顺序下标兜底
        const next: Record<string, number> = { ...heightsRef.current }
        let changed = false
        nodes.forEach((node) => {
          const fromId = node.id?.startsWith('gsl-measure-')
            ? node.id.slice('gsl-measure-'.length)
            : ''
          const id = node.dataset?.id || fromId
          const h = Math.ceil(node.height || 0)
          if (!id || h < 8) return
          if (Math.abs((next[id] || 0) - h) > 1) {
            next[id] = h
            changed = true
          }
        })
        if (changed) setHeights(next)
      })
  }

  useEffect(() => {
    measureScrollRect()
    const enterTimer = setTimeout(() => setEnterAnim(false), 2400)
    return () => {
      clearTimeout(enterTimer)
      flushDragRaf()
      if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (dragging) return
    let alive = true
    const run = () => {
      if (!alive) return
      measureHeights()
      measureScrollRect()
    }
    run()
    const timers = MEASURE_RETRY_MS.map((ms) => setTimeout(run, ms))
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatIds, dragging, props.layoutKey])

  // —— 拖拽：虚拟滚动 / 贴边自动滚 ——
  const stopAutoScroll = () => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current)
      autoScrollRef.current = null
    }
    autoDirRef.current = 0
  }

  const applyVirtualScroll = (next: number, areaY: number) => {
    const maxScroll = Math.max(0, areaHRef.current - viewportHRef.current)
    const clamped = Math.min(maxScroll, Math.max(0, next))
    const cur = scrollTopRef.current
    if (clamped === cur) return false
    const delta = clamped - cur
    scrollTopRef.current = clamped
    const lock = dragLockScrollRef.current
    if (lock != null) {
      setContentShift(lock - clamped)
    } else {
      applyProgramScroll(nudgeScroll(clamped))
    }
    const y = (activeYRef.current ?? areaY) + delta
    activeYRef.current = y
    setActiveY(y)
    hasMovedRef.current = true
    setHasMoved(true)
    return true
  }

  const ensureAutoScroll = (areaY: number, clientY?: number) => {
    const local =
      clientY != null
        ? clientY - scrollRectTopRef.current
        : areaY - scrollTopRef.current
    const edge = Math.min(120, Math.max(64, viewportHRef.current * 0.22))
    let dir = 0
    let speed = 0
    if (local < edge) {
      dir = -1
      speed = Math.max(8, Math.round(((edge - local) / edge) * 28))
    } else if (local > viewportHRef.current - edge) {
      dir = 1
      speed = Math.max(
        8,
        Math.round(((local - (viewportHRef.current - edge)) / edge) * 28),
      )
    }

    if (dir === 0) {
      stopAutoScroll()
      return
    }

    autoSpeedRef.current = speed
    autoDirRef.current = dir
    if (autoScrollRef.current) return

    autoScrollRef.current = setInterval(() => {
      if (!activeIdRef.current) {
        stopAutoScroll()
        return
      }
      const step = autoDirRef.current * autoSpeedRef.current
      const maxScroll = Math.max(0, areaHRef.current - viewportHRef.current)
      const cur = scrollTopRef.current
      const next = Math.min(maxScroll, Math.max(0, cur + step))
      if (next === cur) {
        if (next <= 0 || next >= maxScroll) stopAutoScroll()
        return
      }
      applyVirtualScroll(next, areaY)
    }, 16)
  }

  const contentYFromClientY = (clientY: number) =>
    clientY -
    scrollRectTopRef.current +
    scrollTopRef.current -
    grabOffsetRef.current

  const applyActiveY = (y: number, clientY?: number) => {
    activeYRef.current = y
    const origin = originYRef.current
    if (origin != null && Math.abs(y - origin) > MOVE_THRESHOLD) {
      if (!hasMovedRef.current) {
        hasMovedRef.current = true
        setHasMoved(true)
      }
    }
    pendingDragYRef.current = { y, clientY }
    if (dragRafRef.current != null) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null
      const pending = pendingDragYRef.current
      if (!pending || !activeIdRef.current) return
      setActiveY(pending.y)
      ensureAutoScroll(pending.y, pending.clientY)
    })
  }

  // —— 拖拽生命周期 ——
  const endDrag = () => {
    if (!activeIdRef.current) return
    flushDragRaf()
    stopAutoScroll()
    const preview = hasMovedRef.current ? previewRef.current : null
    const finalScroll = scrollTopRef.current

    activeIdRef.current = null
    originYRef.current = null
    pressRef.current = null
    dragLockScrollRef.current = null
    ignoreClickRef.current = true
    setTimeout(() => {
      ignoreClickRef.current = false
    }, 320)

    if (preview) {
      committedRef.current = preview
      previewRef.current = null
    } else {
      previewRef.current = null
    }

    setActiveId(null)
    setActiveY(null)
    setOriginY(null)
    setHasMoved(false)
    hasMovedRef.current = false
    setContentShift(0)
    setDragLockScroll(null)
    applyProgramScroll(nudgeScroll(finalScroll))
    if (preview) onChangeRef.current(preview)
  }

  const startDrag = (id: string, fallbackBaseY: number, clientY: number) => {
    onDragStartRef.current?.(id)

    const latest = layoutByIdRef.current.get(id)
    const baseY = latest?.baseY ?? fallbackBaseY

    const lock = scrollTopRef.current
    dragLockScrollRef.current = lock
    setDragLockScroll(lock)
    setContentShift(0)

    const itemScreenTop =
      scrollRectTopRef.current + baseY - scrollTopRef.current
    grabOffsetRef.current = clientY - itemScreenTop
    ignoreClickRef.current = true
    activeIdRef.current = id
    originYRef.current = baseY
    activeYRef.current = baseY
    hasMovedRef.current = false
    setActiveId(id)
    setActiveY(baseY)
    setOriginY(baseY)
    setHasMoved(false)

    // 用真实节点矩形校准抓取偏移（不改高度）
    Taro.nextTick(() => {
      if (activeIdRef.current !== id) return
      pageQuery()
        .select('#grouped-sort-scroll')
        .scrollOffset()
        .select('#grouped-sort-scroll')
        .boundingClientRect()
        .select(`#gsl-item-${id}`)
        .boundingClientRect()
        .exec((res) => {
          if (activeIdRef.current !== id) return
          const scroll = res?.[0] as { scrollTop?: number } | undefined
          const scrollRect = res?.[1] as
            | { top?: number; height?: number }
            | undefined
          const itemRect = res?.[2] as
            | { top?: number; height?: number }
            | undefined

          if (scroll?.scrollTop != null && Number.isFinite(scroll.scrollTop)) {
            scrollTopRef.current = scroll.scrollTop
          }
          if (scrollRect?.top != null) {
            scrollRectTopRef.current = scrollRect.top
          }
          if (scrollRect?.height) {
            viewportHRef.current = scrollRect.height
            setViewportH(scrollRect.height)
          }

          const lockTop = scrollTopRef.current
          dragLockScrollRef.current = lockTop
          setDragLockScroll(lockTop)
          setContentShift(0)

          if (itemRect?.top != null && scrollRect?.top != null) {
            const contentY =
              itemRect.top - scrollRect.top + scrollTopRef.current
            grabOffsetRef.current = clientY - itemRect.top
            originYRef.current = contentY
            activeYRef.current = contentY
            setOriginY(contentY)
            setActiveY(contentY)
          }
        })
    })
  }

  /**
   * 空闲：不 catchMove，原生滚动；用 onLongPress 进入拖拽。
   * 拖拽中：全屏遮罩 catchMove 跟手。
   */
  const onItemTouchStart = (
    id: string,
    baseY: number,
    e: { touches?: Array<{ clientX?: number; clientY?: number }> },
  ) => {
    if (activeIdRef.current) return
    const touch = e.touches?.[0]
    const clientX = touch?.clientX
    const clientY = touch?.clientY
    if (clientY == null) return

    pressRef.current = {
      id,
      baseY,
      startX: clientX ?? 0,
      startY: clientY,
      clientY,
      moved: false,
    }
  }

  const onItemLongPress = (id: string, baseY: number) => {
    if (activeIdRef.current) return
    const press = pressRef.current
    if (!press || press.id !== id || press.moved) return
    const latest = layoutByIdRef.current.get(id)
    startDrag(id, latest?.baseY ?? baseY, press.clientY)
  }

  const onDragTouchMove = (e: {
    touches?: Array<{ clientX?: number; clientY?: number }>
    preventDefault?: () => void
    stopPropagation?: () => void
  }) => {
    if (!activeIdRef.current) return
    const touch = e.touches?.[0]
    const clientY = touch?.clientY
    if (clientY == null) return
    e.preventDefault?.()
    e.stopPropagation?.()
    applyActiveY(contentYFromClientY(clientY), clientY)
  }

  const onItemTouchMove = (e: {
    touches?: Array<{ clientX?: number; clientY?: number }>
  }) => {
    if (activeIdRef.current) {
      onDragTouchMove(e)
      return
    }
    const press = pressRef.current
    const touch = e.touches?.[0]
    const clientY = touch?.clientY
    if (!press || clientY == null) return
    press.clientY = clientY
    const dx = Math.abs((touch?.clientX ?? press.startX) - press.startX)
    const dy = Math.abs(clientY - press.startY)
    if (dx > CANCEL_MOVE_PX || dy > CANCEL_MOVE_PX) press.moved = true
  }

  const onItemTouchEnd = () => {
    if (activeIdRef.current) {
      endDrag()
      return
    }
    pressRef.current = null
  }

  const onItemTap = (id: string) => {
    if (dragging || ignoreClickRef.current || hasMovedRef.current) return
    props.onItemClick?.(id)
  }

  return (
    <View
      className={`grouped-sort${dragging ? ' grouped-sort--dragging' : ''}`}
    >
      {props.headerSlot}
      <ScrollView
        id='grouped-sort-scroll'
        className='grouped-sort__scroll'
        scrollY={dragLockScroll == null}
        scrollTop={
          dragLockScroll != null
            ? dragLockScroll
            : scrollApplyNonce > 0
              ? scrollTopRef.current + scrollApplyNonce * 0
              : undefined
        }
        scrollWithAnimation={false}
        onScroll={(e) => {
          if (dragLockScrollRef.current != null) return
          scrollTopRef.current = Number(e.detail.scrollTop) || 0
        }}
      >
        <View
          className='grouped-sort__area'
          style={{
            height: `${totalAreaH}px`,
            width: '100%',
            transform:
              dragLockScroll != null
                ? `translate3d(0, ${contentShift}px, 0)`
                : undefined,
          }}
        >
          {spineHeight > 0 ? (
            <View
              className='grouped-sort__spine'
              style={{
                top: `${spineTop}px`,
                height: `${spineHeight}px`,
              }}
            />
          ) : null}

          {layout.headers.map((h) => {
            const group = displayGroups.find((g) => g.id === h.groupId)
            const riseDelay = riseDelayByKey[`h-${h.groupId}`] ?? 0
            return (
              <View
                key={`h-${h.groupId}`}
                className='grouped-sort__header'
                style={{
                  transform: `translate3d(0, ${h.y}px, 0)`,
                  height: `${headerH}px`,
                  transition: pushTransition,
                }}
              >
                <View
                  className={
                    enterAnim ? 'grouped-sort__rise' : undefined
                  }
                  style={{
                    height: '100%',
                    ...(enterAnim
                      ? { animationDelay: `${riseDelay}ms` }
                      : null),
                  }}
                >
                  {group && props.renderHeader ? (
                    props.renderHeader(group, {
                      dragging,
                      isFirst: h.isFirst,
                    })
                  ) : (
                    <>
                      <Text className='grouped-sort__header-title'>{h.title}</Text>
                      {!!h.subtitle && (
                        <Text className='grouped-sort__header-sub'>{h.subtitle}</Text>
                      )}
                    </>
                  )}
                </View>
              </View>
            )
          })}

          {activeLayoutItem ? (
            <View
              key={`ph-${activeLayoutItem.id}`}
              className='grouped-sort__placeholder'
              style={{
                transform: `translate3d(0, ${
                  hasMoved
                    ? activeLayoutItem.baseY
                    : originY ?? activeLayoutItem.baseY
                }px, 0)`,
                height: `${activeLayoutItem.height}px`,
                transition: pushTransition,
              }}
            >
              <View className='grouped-sort__placeholder-row'>
                <View className='grouped-sort__placeholder-rail' />
                <View className='grouped-sort__placeholder-box' />
              </View>
            </View>
          ) : null}

          {stableItems.map((item) => {
            const isActive = item.id === activeId
            const riseDelay = riseDelayByKey[`i-${item.id}`] ?? 0
            return (
              <View
                key={item.id}
                id={`gsl-item-${item.id}`}
                className={`grouped-sort__item${
                  isActive
                    ? ' grouped-sort__item--hole'
                    : ' grouped-sort__item--rest'
                }`}
                style={{
                  transform: `translate3d(0, ${item.baseY}px, 0)`,
                  minHeight: `${item.height}px`,
                  transition: isActive ? 'none' : pushTransition,
                  opacity: isActive ? 0 : 1,
                }}
                onTouchStart={(e) =>
                  onItemTouchStart(item.id, item.baseY, e as never)
                }
                onLongPress={() => onItemLongPress(item.id, item.baseY)}
                onTouchMove={(e) => onItemTouchMove(e as never)}
                onTouchEnd={onItemTouchEnd}
                onTouchCancel={onItemTouchEnd}
                onClick={() => onItemTap(item.id)}
              >
                <View
                  className={`grouped-sort__item-inner${
                    enterAnim && !isActive ? ' grouped-sort__rise' : ''
                  }`}
                  style={
                    enterAnim && !isActive
                      ? { animationDelay: `${riseDelay}ms` }
                      : undefined
                  }
                >
                  <View
                    id={`gsl-measure-${item.id}`}
                    className='gsl-measure'
                    data-id={item.id}
                  >
                    {props.renderItem(item.data, {
                      dragging: false,
                      isLast: item.isLast,
                      isFirstInGroup: item.isFirstInGroup,
                    })}
                  </View>
                </View>
              </View>
            )
          })}

          {dragging && activeLayoutItem && activeY != null ? (
            <View
              className='grouped-sort__item grouped-sort__item--float'
              style={{
                transform: `translate3d(0, ${activeY}px, 0)`,
                height: `${activeLayoutItem.height}px`,
              }}
            >
              <View className='grouped-sort__item-inner'>
                {props.renderItem(activeLayoutItem.data, {
                  dragging: true,
                  isLast: activeLayoutItem.isLast,
                  isFirstInGroup: activeLayoutItem.isFirstInGroup,
                })}
              </View>
            </View>
          ) : null}

          {props.footerSlot ? (
            <View
              className='grouped-sort__footer'
              style={{
                transform: `translate3d(0, ${footerY}px, 0)`,
                height: `${footerH}px`,
              }}
            >
              <View
                className={enterAnim ? 'grouped-sort__rise' : undefined}
                style={
                  enterAnim
                    ? {
                        animationDelay: `${riseDelayByKey.footer ?? 0}ms`,
                        height: '100%',
                      }
                    : { height: '100%' }
                }
              >
                {props.footerSlot}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {dragging ? (
        <View
          className='grouped-sort__drag-mask'
          catchMove
          onTouchMove={(e) => onDragTouchMove(e as never)}
          onTouchEnd={onItemTouchEnd}
          onTouchCancel={onItemTouchEnd}
        />
      ) : null}
    </View>
  )
}

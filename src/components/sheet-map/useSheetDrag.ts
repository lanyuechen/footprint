import { useRef, useState, type MutableRefObject } from 'react'
import type { SheetPos } from './types'

const SHEET_TAP_SLOP_PX = 10

export type UseSheetDragOptions = {
  heightForPos: (pos: SheetPos) => number
  pos: SheetPos
  setPos: (pos: SheetPos) => void
  /** 吸附前可拦截；返回 false 则取消本次吸附（调用方自行处理） */
  onBeforeSnap?: (next: SheetPos, from: SheetPos) => boolean | void
}

export type UseSheetDragResult = {
  dragHeightPx: number | null
  sheetHeightNow: number
  sheetDragging: boolean
  showSheetBody: boolean
  dragMovedRef: MutableRefObject<boolean>
  onSheetTouchStart: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchMove: (e: { touches: Array<{ clientY: number }> }) => void
  onSheetTouchEnd: (e: {
    changedTouches?: Array<{ clientY: number }>
    touches?: Array<{ clientY: number }>
  }) => void
  resolveHeightSnap: (heightPx: number) => SheetPos
}

export function useSheetDrag(options: UseSheetDragOptions): UseSheetDragResult {
  const { heightForPos, pos, setPos, onBeforeSnap } = options
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null)
  const dragRef = useRef<{
    active: boolean
    startY: number
    startH: number
    from: SheetPos
  } | null>(null)
  const dragMovedRef = useRef(false)
  const heightForPosRef = useRef(heightForPos)
  heightForPosRef.current = heightForPos
  const posRef = useRef(pos)
  posRef.current = pos
  const setPosRef = useRef(setPos)
  setPosRef.current = setPos
  const onBeforeSnapRef = useRef(onBeforeSnap)
  onBeforeSnapRef.current = onBeforeSnap

  const sheetHeightNow =
    dragHeightPx != null ? dragHeightPx : heightForPos(pos)
  const sheetDragging = dragHeightPx != null
  const showSheetBody = pos !== 'bottom' || dragHeightPx != null

  const resolveHeightSnap = (heightPx: number): SheetPos => {
    const minH = heightForPosRef.current('bottom')
    const maxH = heightForPosRef.current('top')
    const t = (heightPx - minH) / Math.max(maxH - minH, 1)
    if (t < 0.25) return 'bottom'
    if (t < 0.75) return 'middle'
    return 'top'
  }

  const onSheetTouchStart = (e: { touches: Array<{ clientY: number }> }) => {
    const clientY = e.touches?.[0]?.clientY
    if (clientY == null) return
    const current = posRef.current
    const startH = heightForPosRef.current(current)
    dragMovedRef.current = false
    dragRef.current = {
      active: true,
      startY: clientY,
      startH,
      from: current,
    }
    // 点按不立刻改高度，避免父级 style 抖动把内部 ScrollView 滚回开头
  }

  const onSheetTouchMove = (e: { touches: Array<{ clientY: number }> }) => {
    const drag = dragRef.current
    if (!drag?.active) return
    const clientY = e.touches?.[0]?.clientY
    if (clientY == null) return
    const dy = clientY - drag.startY
    if (Math.abs(dy) <= SHEET_TAP_SLOP_PX && !dragMovedRef.current) return

    dragMovedRef.current = true
    const minH = heightForPosRef.current('bottom')
    const maxH = heightForPosRef.current('top')
    const next = Math.min(maxH, Math.max(minH, drag.startH - dy))
    setDragHeightPx(next)
  }

  const onSheetTouchEnd = (e: {
    changedTouches?: Array<{ clientY: number }>
    touches?: Array<{ clientY: number }>
  }) => {
    const drag = dragRef.current
    if (!drag?.active) return
    dragRef.current = null

    // 未越过阈值：视为点击，不改档位、不碰高度
    if (!dragMovedRef.current) {
      setDragHeightPx(null)
      return
    }

    const clientY =
      e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY ?? drag.startY
    const dy = clientY - drag.startY
    const heightNow = Math.min(
      heightForPosRef.current('top'),
      Math.max(heightForPosRef.current('bottom'), drag.startH - dy),
    )
    const next = resolveHeightSnap(heightNow)
    const allow = onBeforeSnapRef.current?.(next, drag.from)
    if (allow === false) {
      setDragHeightPx(null)
      return
    }
    setPosRef.current(next)
    setDragHeightPx(null)
  }

  return {
    dragHeightPx,
    sheetHeightNow,
    sheetDragging,
    showSheetBody,
    dragMovedRef,
    onSheetTouchStart,
    onSheetTouchMove,
    onSheetTouchEnd,
    resolveHeightSnap,
  }
}

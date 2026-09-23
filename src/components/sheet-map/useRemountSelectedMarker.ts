import { useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'

function withSelectedOnTop(
  markers: Array<Record<string, unknown>>,
  selectedId: number | null,
): Array<Record<string, unknown>> {
  if (selectedId == null) return markers
  const others: Array<Record<string, unknown>> = []
  let selected: Record<string, unknown> | undefined
  for (const m of markers) {
    if (Number(m.id) === selectedId) selected = m
    else others.push(m)
  }
  return selected ? [...others, selected] : markers
}

/**
 * 选中变更时先从 markers 移除选中点，再在 nextTick 加回末尾，
 * 让微信地图按「后添加」绘制在最上层（zIndex 不可靠）。
 */
export function useRemountSelectedMarker(
  markers: Array<Record<string, unknown>>,
  selectedId: number | null,
): Array<Record<string, unknown>> {
  const [display, setDisplay] = useState(() =>
    withSelectedOnTop(markers, selectedId),
  )
  const prevSelectedRef = useRef(selectedId)
  const markersRef = useRef(markers)
  markersRef.current = markers

  useEffect(() => {
    const prevSelected = prevSelectedRef.current
    prevSelectedRef.current = selectedId

    if (selectedId == null || selectedId === prevSelected) {
      setDisplay(withSelectedOnTop(markers, selectedId))
      return
    }

    // 先移除，再在下一帧加回末尾（拆开两次提交，避免被 React 合并）
    setDisplay(markers.filter((m) => Number(m.id) !== selectedId))
    let cancelled = false
    Taro.nextTick(() => {
      if (cancelled) return
      setDisplay(withSelectedOnTop(markersRef.current, selectedId))
    })
    return () => {
      cancelled = true
    }
  }, [markers, selectedId])

  return display
}

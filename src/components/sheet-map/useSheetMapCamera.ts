import Taro from '@tarojs/taro'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  DEFAULT_CENTER,
  DEFAULT_SHEET_MIDDLE_VH,
  easeOutCubic,
  fitMapToPoints,
  getWindowMetrics,
  mapHeightFromSheet,
  MAP_CENTER_EASE_MS,
  nearlySameCoord,
} from './map-geometry'
import type { MapCoord, MapRegionChangeEvent } from './types'

function isUserMapGesture(causedBy?: string) {
  return (
    causedBy === 'gesture' || causedBy === 'drag' || causedBy === 'scale'
  )
}

type ViewportOpts = {
  /** 默认 true；首屏 / fit 点用 false，避免从默认视野缓动过去 */
  animate?: boolean
}

/** 底栏几乎全屏时可视高度≈0，fit 按 middle 可视高度算 */
function visibleHeightForFit(sheetHeightPx: number): number {
  const visibleH = mapHeightFromSheet(sheetHeightPx)
  const { windowHeight } = getWindowMetrics()
  const middleVisibleH = mapHeightFromSheet(
    windowHeight * DEFAULT_SHEET_MIDDLE_VH,
  )
  if (visibleH < middleVisibleH * 0.5) return middleVisibleH
  return visibleH
}

function resolveSeedViewport(
  points: MapCoord[] | undefined,
  sheetHeightPx: number,
): { center: MapCoord; scale: number } {
  const visibleH = visibleHeightForFit(sheetHeightPx)
  if (!points || points.length === 0) {
    return { center: { ...DEFAULT_CENTER }, scale: 12 }
  }
  const fitted = fitMapToPoints(points, visibleH)
  return { center: fitted.center, scale: fitted.scale }
}

export type UseSheetMapCameraOptions = {
  mapId: string
  /** 当前底栏高度；用于可视区 fit，不改变地图组件尺寸 */
  sheetHeightPx: number
  /** 拖底栏中：不做中心缓动 */
  sheetDragging: boolean
  /** 仅首屏种子视野，避免先闪默认中心再 fit */
  seedPoints?: MapCoord[]
}

export type UseSheetMapCameraResult = {
  mapCenter: MapCoord
  mapScale: number
  /** 与 mapCenter 目标一致；缓动过程中可能短暂不同 */
  focusCoord: MapCoord
  gesturingRef: MutableRefObject<boolean>
  fitToPoints: (points: MapCoord[], opts?: ViewportOpts) => void
  setFocusCoord: (coord: MapCoord) => void
  beginOwnMapMove: () => void
  endOwnMapMove: () => void
  onRegionChange: (e: MapRegionChangeEvent) => void
}

/**
 * 地图组件固定全屏；焦点经纬度 = 地图中心。
 * 可视区对齐由 SheetMapFrame 的 translateY 完成。
 */
export function useSheetMapCamera(
  options: UseSheetMapCameraOptions,
): UseSheetMapCameraResult {
  const { mapId, sheetHeightPx: sheetH, sheetDragging } = options

  const seedRef = useRef(
    resolveSeedViewport(options.seedPoints, options.sheetHeightPx),
  )

  const [mapCenter, setMapCenter] = useState(seedRef.current.center)
  const [focusCoord, setFocusCoordState] = useState(seedRef.current.center)
  const [mapScale, setMapScale] = useState(seedRef.current.scale)

  const gesturingRef = useRef(false)
  const mapCenterDisplayRef = useRef(seedRef.current.center)
  const mapCenterAnimRaf = useRef<number | null>(null)
  const mapScaleRef = useRef(seedRef.current.scale)
  const sheetHRef = useRef(sheetH)
  const suppressCenterFollowRef = useRef(false)
  const ownMapMoveRef = useRef(false)
  const ignoreMapRegionRef = useRef(false)
  const ignoreMapRegionTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const sheetDraggingRef = useRef(sheetDragging)
  sheetDraggingRef.current = sheetDragging
  sheetHRef.current = sheetH
  mapScaleRef.current = mapScale

  const clearIgnoreMapRegion = () => {
    if (ignoreMapRegionTimer.current) {
      clearTimeout(ignoreMapRegionTimer.current)
      ignoreMapRegionTimer.current = null
    }
    ignoreMapRegionRef.current = false
  }

  const armIgnoreMapRegion = (ms: number) => {
    ignoreMapRegionRef.current = true
    if (ignoreMapRegionTimer.current) clearTimeout(ignoreMapRegionTimer.current)
    ignoreMapRegionTimer.current = setTimeout(() => {
      ignoreMapRegionRef.current = false
      ignoreMapRegionTimer.current = null
    }, ms)
  }

  const cancelMapCenterAnim = () => {
    if (mapCenterAnimRaf.current != null) {
      cancelAnimationFrame(mapCenterAnimRaf.current)
      mapCenterAnimRaf.current = null
    }
  }

  const applyMapCenter = (
    next: MapCoord,
    opts?: { animate?: boolean },
  ) => {
    if (gesturingRef.current) return
    mapCenterDisplayRef.current = next
    setMapCenter(next)
    armIgnoreMapRegion(opts?.animate ? MAP_CENTER_EASE_MS + 40 : 80)
  }

  // 焦点变更时驱动地图中心
  useEffect(() => {
    if (gesturingRef.current) return

    const to = focusCoord
    const from = mapCenterDisplayRef.current

    if (suppressCenterFollowRef.current) {
      suppressCenterFollowRef.current = false
      mapCenterDisplayRef.current = to
      if (!nearlySameCoord(from, to)) setMapCenter(to)
      return
    }

    cancelMapCenterAnim()

    if (sheetDragging) {
      applyMapCenter(to)
      return
    }

    if (nearlySameCoord(from, to)) {
      mapCenterDisplayRef.current = to
      return
    }

    const startedAt = Date.now()
    const start = { ...from }
    armIgnoreMapRegion(MAP_CENTER_EASE_MS + 40)

    const tick = () => {
      if (gesturingRef.current) {
        mapCenterAnimRaf.current = null
        clearIgnoreMapRegion()
        return
      }
      const t = Math.min(1, (Date.now() - startedAt) / MAP_CENTER_EASE_MS)
      const e = easeOutCubic(t)
      const next = {
        latitude: start.latitude + (to.latitude - start.latitude) * e,
        longitude: start.longitude + (to.longitude - start.longitude) * e,
      }
      mapCenterDisplayRef.current = next
      setMapCenter(next)
      if (t < 1) {
        mapCenterAnimRaf.current = requestAnimationFrame(tick)
      } else {
        mapCenterAnimRaf.current = null
      }
    }
    mapCenterAnimRaf.current = requestAnimationFrame(tick)
    return () => {
      cancelMapCenterAnim()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCoord, sheetDragging])

  useEffect(() => {
    return () => {
      cancelMapCenterAnim()
      clearIgnoreMapRegion()
    }
  }, [])

  const applyFocusViewport = (
    focus: MapCoord,
    scale: number,
    opts?: ViewportOpts,
  ) => {
    const animate = opts?.animate !== false
    const nextScale = Math.min(20, Math.max(3, Math.round(scale)))
    gesturingRef.current = false
    mapScaleRef.current = nextScale
    setMapScale(nextScale)
    setFocusCoordState(focus)

    if (!animate) {
      suppressCenterFollowRef.current = true
      applyMapCenter(focus)
    }
  }

  const fitToPoints = (points: MapCoord[], opts?: ViewportOpts) => {
    const animate = opts?.animate !== false
    if (points.length === 0) {
      applyFocusViewport(DEFAULT_CENTER, 12, { animate })
      return
    }
    const fitted = fitMapToPoints(
      points,
      visibleHeightForFit(sheetHRef.current),
    )
    applyFocusViewport(fitted.center, fitted.scale, { animate })
  }

  const setFocusCoord = (coord: MapCoord) => {
    setFocusCoordState(coord)
  }

  const beginOwnMapMove = () => {
    ownMapMoveRef.current = true
  }

  const endOwnMapMove = () => {
    ownMapMoveRef.current = false
  }

  const syncMapCenterFromUser = (
    center: MapCoord | null,
    scaleRaw?: number,
  ) => {
    gesturingRef.current = false
    if (center) {
      suppressCenterFollowRef.current = true
      mapCenterDisplayRef.current = center
      setMapCenter(center)
      setFocusCoordState(center)
    }
    if (scaleRaw != null && Number.isFinite(scaleRaw)) {
      const next = Math.min(20, Math.max(3, Math.round(scaleRaw)))
      mapScaleRef.current = next
      setMapScale((prev) => (prev === next ? prev : next))
    }
  }

  const onRegionChange = (e: MapRegionChangeEvent) => {
    const detail = (e.detail || {}) as {
      type?: string
      causedBy?: string
      centerLocation?: MapCoord
      latitude?: number
      longitude?: number
      scale?: number
    }
    const type = e.type || detail.type
    const causedBy = e.causedBy || detail.causedBy

    if (type === 'begin') {
      if (isUserMapGesture(causedBy)) {
        gesturingRef.current = true
        cancelMapCenterAnim()
        clearIgnoreMapRegion()
      }
      return
    }
    if (type !== 'end') return

    const centerFromEvent =
      detail.centerLocation ||
      (detail.latitude != null && detail.longitude != null
        ? { latitude: detail.latitude, longitude: detail.longitude }
        : null)

    if (
      gesturingRef.current ||
      (isUserMapGesture(causedBy) && !ownMapMoveRef.current)
    ) {
      const finishGesture = (center: MapCoord | null, scaleRaw?: number) => {
        syncMapCenterFromUser(
          center,
          causedBy === 'scale' ? scaleRaw : undefined,
        )
      }

      if (causedBy === 'scale' && detail.scale == null) {
        try {
          Taro.createMapContext(mapId).getScale({
            success: (res) => finishGesture(centerFromEvent, res.scale),
            fail: () => finishGesture(centerFromEvent),
          })
        } catch {
          finishGesture(centerFromEvent)
        }
        return
      }

      if (centerFromEvent) {
        finishGesture(
          centerFromEvent,
          causedBy === 'scale' ? detail.scale : undefined,
        )
        return
      }

      try {
        Taro.createMapContext(mapId).getCenterLocation({
          success: (res) => {
            finishGesture(
              { latitude: res.latitude, longitude: res.longitude },
              causedBy === 'scale' ? detail.scale : undefined,
            )
          },
          fail: () => finishGesture(null),
        })
      } catch {
        finishGesture(null)
      }
      return
    }

    if (
      ownMapMoveRef.current ||
      causedBy === 'update' ||
      causedBy === 'scale'
    ) {
      return
    }
    if (ignoreMapRegionRef.current) return
    if (sheetDraggingRef.current) return
    if (mapCenterAnimRaf.current != null) return
    if (!centerFromEvent) return

    suppressCenterFollowRef.current = true
    mapCenterDisplayRef.current = centerFromEvent
    setMapCenter(centerFromEvent)
    setFocusCoordState(centerFromEvent)
  }

  return {
    mapCenter,
    mapScale,
    focusCoord,
    gesturingRef,
    fitToPoints,
    setFocusCoord,
    beginOwnMapMove,
    endOwnMapMove,
    onRegionChange,
  }
}

import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  coverRatioFromSheetHeight,
  DEFAULT_CENTER,
  easeOutCubic,
  estimateMapLatSpan,
  fitMapToPoints,
  MAP_CENTER_EASE_MS,
  nearlySameCoord,
  offsetCenterForSheet,
  readLatSpanFromRegion,
  reverseOffsetCenterForSheet,
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

function resolveSeedViewport(
  points: MapCoord[] | undefined,
  sheetHeightPx: number,
): { focus: MapCoord; scale: number; span: number; center: MapCoord } {
  const cover = coverRatioFromSheetHeight(sheetHeightPx)
  if (!points || points.length === 0) {
    const focus = { ...DEFAULT_CENTER }
    const scale = 12
    const span = estimateMapLatSpan(scale, focus.latitude)
    return {
      focus,
      scale,
      span,
      center: offsetCenterForSheet(focus, cover, span),
    }
  }
  const fitted = fitMapToPoints(points, cover)
  const span = estimateMapLatSpan(fitted.scale, fitted.center.latitude)
  return {
    focus: fitted.center,
    scale: fitted.scale,
    span,
    center: offsetCenterForSheet(fitted.center, cover, span),
  }
}

export type UseSheetMapCameraOptions = {
  mapId: string
  /** 当前底栏高度（拖拽中或吸附档位） */
  sheetHeightPx: number
  /** 拖底栏中：中心跟手、不做缓动 */
  sheetDragging: boolean
  /** 仅首屏种子视野，避免先闪默认中心再 fit */
  seedPoints?: MapCoord[]
}

export type UseSheetMapCameraResult = {
  mapCenter: MapCoord
  mapScale: number
  focusCoord: MapCoord
  sheetCoverRatio: number
  gesturingRef: MutableRefObject<boolean>
  applyFocusViewport: (
    focus: MapCoord,
    scale: number,
    opts?: ViewportOpts,
  ) => void
  fitToPoints: (points: MapCoord[], opts?: ViewportOpts) => void
  setFocusCoord: (coord: MapCoord) => void
  rememberLatSpan: (span: number | null | undefined) => void
  beginOwnMapMove: () => void
  endOwnMapMove: () => void
  isOwnMapMove: () => boolean
  onRegionChange: (e: MapRegionChangeEvent) => void
}

export function useSheetMapCamera(
  options: UseSheetMapCameraOptions,
): UseSheetMapCameraResult {
  const { mapId, sheetHeightPx: sheetH, sheetDragging } = options

  const seedRef = useRef(
    resolveSeedViewport(options.seedPoints, options.sheetHeightPx),
  )

  const [focusCoord, setFocusCoordState] = useState(seedRef.current.focus)
  const [mapScale, setMapScale] = useState(seedRef.current.scale)
  const [mapViewLatSpan, setMapViewLatSpan] = useState(seedRef.current.span)
  const [mapCenter, setMapCenter] = useState(seedRef.current.center)

  const gesturingRef = useRef(false)
  const mapCenterDisplayRef = useRef(seedRef.current.center)
  const mapCenterAnimRaf = useRef<number | null>(null)
  const mapViewLatSpanRef = useRef(seedRef.current.span)
  const mapScaleRef = useRef(seedRef.current.scale)
  const sheetCoverRatioRef = useRef(0.12)
  const suppressCenterFollowRef = useRef(false)
  const ownMapMoveRef = useRef(false)
  const ignoreMapRegionRef = useRef(false)
  const ignoreMapRegionTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const sheetDraggingRef = useRef(sheetDragging)
  sheetDraggingRef.current = sheetDragging

  const sheetCoverRatio = coverRatioFromSheetHeight(sheetH)
  sheetCoverRatioRef.current = sheetCoverRatio
  mapScaleRef.current = mapScale
  mapViewLatSpanRef.current = mapViewLatSpan

  const effectiveLatSpan =
    mapViewLatSpan > 0
      ? mapViewLatSpan
      : estimateMapLatSpan(mapScale, focusCoord.latitude)

  const targetMapCenter = useMemo(
    () => offsetCenterForSheet(focusCoord, sheetCoverRatio, effectiveLatSpan),
    [focusCoord, sheetCoverRatio, effectiveLatSpan],
  )

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

  useEffect(() => {
    if (gesturingRef.current) return

    const to = targetMapCenter
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
  }, [targetMapCenter, sheetDragging])

  useEffect(() => {
    return () => {
      cancelMapCenterAnim()
      clearIgnoreMapRegion()
    }
  }, [])

  const rememberLatSpan = (
    span: number | null | undefined,
    opts?: { quiet?: boolean },
  ) => {
    if (span == null || !(span > 0)) return
    const prev = mapViewLatSpanRef.current
    mapViewLatSpanRef.current = span
    if (Math.abs(prev - span) < 1e-10) return
    // 程序改视野期间：只写入 ref，避免跨度回写触发中心再跳一次
    if (
      opts?.quiet ||
      ignoreMapRegionRef.current ||
      ownMapMoveRef.current ||
      mapCenterAnimRaf.current != null
    ) {
      return
    }
    setMapViewLatSpan(span)
  }

  const applyFocusViewport = (
    focus: MapCoord,
    scale: number,
    opts?: ViewportOpts,
  ) => {
    const animate = opts?.animate !== false
    const nextScale = Math.min(20, Math.max(3, Math.round(scale)))
    const span = estimateMapLatSpan(nextScale, focus.latitude)
    mapViewLatSpanRef.current = span
    setMapViewLatSpan(span)
    setFocusCoordState(focus)
    gesturingRef.current = false
    mapScaleRef.current = nextScale
    setMapScale(nextScale)

    if (!animate) {
      const center = offsetCenterForSheet(
        focus,
        sheetCoverRatioRef.current,
        span,
      )
      suppressCenterFollowRef.current = true
      applyMapCenter(center)
    }
  }

  const fitToPoints = (points: MapCoord[], opts?: ViewportOpts) => {
    const cover = sheetCoverRatioRef.current
    const animate = opts?.animate !== false
    if (points.length === 0) {
      applyFocusViewport(DEFAULT_CENTER, 12, { animate })
      return
    }
    const fitted = fitMapToPoints(points, cover)
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

  const isOwnMapMove = () => ownMapMoveRef.current

  const syncMapCenterFromUser = (
    center: MapCoord | null,
    scaleRaw?: number,
  ) => {
    gesturingRef.current = false
    if (center) {
      const latSpan =
        mapViewLatSpanRef.current > 0
          ? mapViewLatSpanRef.current
          : estimateMapLatSpan(
              scaleRaw ?? mapScaleRef.current,
              center.latitude,
            )
      const anchor = reverseOffsetCenterForSheet(
        center,
        sheetCoverRatioRef.current,
        latSpan,
      )
      suppressCenterFollowRef.current = true
      mapCenterDisplayRef.current = center
      setMapCenter(center)
      setFocusCoordState(anchor)
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
      region?: {
        northeast?: { latitude: number; longitude: number }
        southwest?: { latitude: number; longitude: number }
        southeast?: { latitude: number; longitude: number }
      }
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

    const spanFromEvent = readLatSpanFromRegion(detail.region)
    if (spanFromEvent) {
      rememberLatSpan(spanFromEvent, {
        quiet:
          ignoreMapRegionRef.current ||
          ownMapMoveRef.current ||
          !isUserMapGesture(causedBy),
      })
    }

    const centerFromEvent =
      detail.centerLocation ||
      (detail.latitude != null && detail.longitude != null
        ? { latitude: detail.latitude, longitude: detail.longitude }
        : null)

    // 用户手势结束
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

    // 程序改中心/缩放：跨度已在上方 quiet 回写；不再二次改 focus
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

    const latSpan =
      spanFromEvent ||
      mapViewLatSpanRef.current ||
      estimateMapLatSpan(mapScaleRef.current, centerFromEvent.latitude)
    const anchor = reverseOffsetCenterForSheet(
      centerFromEvent,
      sheetCoverRatioRef.current,
      latSpan,
    )
    suppressCenterFollowRef.current = true
    mapCenterDisplayRef.current = centerFromEvent
    setMapCenter(centerFromEvent)
    setFocusCoordState(anchor)
  }

  return {
    mapCenter,
    mapScale,
    focusCoord,
    sheetCoverRatio,
    gesturingRef,
    applyFocusViewport,
    fitToPoints,
    setFocusCoord,
    rememberLatSpan,
    beginOwnMapMove,
    endOwnMapMove,
    isOwnMapMove,
    onRegionChange,
  }
}

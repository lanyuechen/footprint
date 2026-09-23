import Taro from '@tarojs/taro'
import type { SheetPos } from './types'

export const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }
export const SEARCH_DEBOUNCE_MS = 400
export const MARKER_ID_SEARCH = 9000
/** 关键节点路径距离标签 marker id 起点 */
export const MARKER_ID_ROUTE_DIST = 9100

export const DEFAULT_SHEET_BOTTOM_RPX = 168
export const DEFAULT_SHEET_MIDDLE_VH = 0.52

/** 与底栏 height transition 对齐 */
export const MAP_CENTER_EASE_MS = 320

export type SheetHeightOptions = {
  bottomRpx?: number
  middleVh?: number
}

export function getWindowMetrics() {
  const info = Taro.getWindowInfo?.() || Taro.getSystemInfoSync()
  return {
    windowHeight: info.windowHeight || 667,
    windowWidth: info.windowWidth || 375,
  }
}

export function sheetHeightPx(
  pos: SheetPos,
  opts?: SheetHeightOptions,
): number {
  const { windowHeight, windowWidth } = getWindowMetrics()
  const bottomRpx = opts?.bottomRpx ?? DEFAULT_SHEET_BOTTOM_RPX
  const middleVh = opts?.middleVh ?? DEFAULT_SHEET_MIDDLE_VH
  if (pos === 'top') return windowHeight
  if (pos === 'middle') return windowHeight * middleVh
  return (bottomRpx / 750) * windowWidth
}

/** 底栏上方地图可视高度（fit / 估算跨度用；地图组件本身仍全屏） */
export function mapHeightFromSheet(sheetHeightPx: number): number {
  const { windowHeight } = getWindowMetrics()
  return Math.max(windowHeight - Math.max(sheetHeightPx, 0), 1)
}

/**
 * 全屏地图上移量：使地图几何中心对齐「底栏上方可视区」中心。
 * translateY(-sheetHeight/2)
 */
export function mapShiftYFromSheet(sheetHeightPx: number): number {
  return Math.max(sheetHeightPx, 0) / 2
}

export function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

export function nearlySameCoord(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-7 &&
    Math.abs(a.longitude - b.longitude) < 1e-7
  )
}

/**
 * 根据点包围盒计算中心与缩放，使点落在「可视区域」内。
 * 包围盒外扩三分之一，避免点贴边。
 * visibleHeightPx：底栏上方可视高度（窗口高 − 底栏高）。
 */
export function fitMapToPoints(
  coords: Array<{ latitude: number; longitude: number }>,
  visibleHeightPx: number,
): { center: { latitude: number; longitude: number }; scale: number } {
  if (coords.length === 0) {
    return { center: { ...DEFAULT_CENTER }, scale: 12 }
  }
  if (coords.length === 1) {
    return {
      center: {
        latitude: coords[0].latitude,
        longitude: coords[0].longitude,
      },
      scale: 15,
    }
  }

  let minLat = coords[0].latitude
  let maxLat = coords[0].latitude
  let minLng = coords[0].longitude
  let maxLng = coords[0].longitude
  for (let i = 1; i < coords.length; i++) {
    const { latitude, longitude } = coords[i]
    if (latitude < minLat) minLat = latitude
    if (latitude > maxLat) maxLat = latitude
    if (longitude < minLng) minLng = longitude
    if (longitude > maxLng) maxLng = longitude
  }

  const center = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  }

  const latSpan = Math.max(maxLat - minLat, 1e-5) * (4 / 3)
  const lngSpan = Math.max(maxLng - minLng, 1e-5) * (4 / 3)

  const { windowWidth } = getWindowMetrics()
  const mapH = Math.max(visibleHeightPx, 1)
  const cosLat = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.2)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * cosLat
  const scaleFromLat = Math.log2(
    (156543.03392804097 * cosLat * mapH) / (metersPerDegLat * latSpan),
  )
  const scaleFromLng = Math.log2(
    (156543.03392804097 * cosLat * windowWidth) /
      (metersPerDegLng * lngSpan),
  )

  let scale = Math.min(scaleFromLat, scaleFromLng)
  if (!Number.isFinite(scale)) scale = 12
  scale = Math.min(17, Math.max(4, Math.floor(scale)))

  return { center, scale }
}

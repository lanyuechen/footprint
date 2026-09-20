import Taro from '@tarojs/taro'
import type { SheetPos } from './types'

export const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }
export const SEARCH_DEBOUNCE_MS = 400
export const MARKER_ID_SEARCH = 9000

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

export function coverRatioFromSheetHeight(heightPx: number): number {
  const { windowHeight } = getWindowMetrics()
  if (windowHeight <= 0) return 0.12
  return Math.min(Math.max(heightPx / windowHeight, 0), 0.7)
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
 * 估算当前缩放下地图纬度跨度（仅作 getRegion 前的回退）。
 */
export function estimateMapLatSpan(
  scale: number,
  latitude: number,
  mapHeightPx?: number,
) {
  const { windowHeight } = getWindowMetrics()
  const height = Math.max(mapHeightPx ?? windowHeight, 1)
  const zoom = Math.min(Math.max(scale, 3), 20)
  const metersPerPixel =
    (156543.03392804097 * Math.cos((latitude * Math.PI) / 180)) /
    Math.pow(2, zoom)
  return (metersPerPixel * height) / 111320
}

export function readLatSpanFromRegion(region?: {
  northeast?: { latitude: number; longitude: number }
  southwest?: { latitude: number; longitude: number }
  southeast?: { latitude: number; longitude: number }
}): number | null {
  if (!region?.northeast) return null
  const sw = region.southwest || region.southeast
  if (!sw) return null
  const span = Math.abs(region.northeast.latitude - sw.latitude)
  return span > 1e-8 ? span : null
}

/**
 * 把目标点对齐到「未被底栏遮挡」的可视中心。
 * latSpan 必须尽量来自地图真实可视区域，避免不同缩放等级偏移不准。
 */
export function offsetCenterForSheet(
  center: { latitude: number; longitude: number },
  coverRatio: number,
  latSpan: number,
) {
  if (!(latSpan > 0)) return { ...center }
  const clamped = Math.min(Math.max(coverRatio, 0), 0.7)
  return {
    latitude: center.latitude - latSpan * (clamped / 2),
    longitude: center.longitude,
  }
}

/** 由地图组件中心反推「可视锚点」 */
export function reverseOffsetCenterForSheet(
  mapCenter: { latitude: number; longitude: number },
  coverRatio: number,
  latSpan: number,
) {
  if (!(latSpan > 0)) return { ...mapCenter }
  const clamped = Math.min(Math.max(coverRatio, 0), 0.7)
  return {
    latitude: mapCenter.latitude + latSpan * (clamped / 2),
    longitude: mapCenter.longitude,
  }
}

/**
 * 根据全部点的包围盒计算中心与缩放，使点落在底栏上方可视区域内。
 * 包围盒外扩三分之一，避免点贴边。
 */
export function fitMapToPoints(
  coords: Array<{ latitude: number; longitude: number }>,
  coverRatio: number,
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

  const { windowHeight, windowWidth } = getWindowMetrics()
  const cosLat = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.2)
  const visibleHeightRatio = Math.max(
    1 - Math.min(Math.max(coverRatio, 0), 0.7),
    0.35,
  )
  const neededFullLat = latSpan / visibleHeightRatio
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * cosLat
  const scaleFromLat = Math.log2(
    (156543.03392804097 * cosLat * windowHeight) /
      (metersPerDegLat * neededFullLat),
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

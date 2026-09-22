import type { PlaceInfo } from '../../types'

export function isSamePlace(a: PlaceInfo, b: PlaceInfo): boolean {
  if (a.poiId && b.poiId) return a.poiId === b.poiId
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6 &&
    a.name === b.name
  )
}

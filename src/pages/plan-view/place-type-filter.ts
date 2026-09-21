import type { CollectedPlace, PlaceInfo } from '../../types'
import {
  matchPlaceTypeOption,
  type PlaceTypeOption,
} from './place-axis'

/** 用 marker 作为筛选稳定 key */
export function placeTypeFilterKey(option: PlaceTypeOption): string {
  return option.mark.marker
}

/** 从当前计划收藏地点汇总出现过的类型 */
export function collectPlaceTypeOptions(
  places: CollectedPlace[],
): PlaceTypeOption[] {
  const seen = new Set<string>()
  const out: PlaceTypeOption[] = []
  for (const item of places) {
    const opt = matchPlaceTypeOption(item.place)
    const key = placeTypeFilterKey(opt)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(opt)
  }
  return out
}

export function placeMatchesTypeFilter(
  place: PlaceInfo,
  selectedKeys: string[],
): boolean {
  if (selectedKeys.length === 0) return false
  const key = placeTypeFilterKey(matchPlaceTypeOption(place))
  return selectedKeys.includes(key)
}

export function filterStopsByPlaceType(
  stops: Array<{ placeId: string }>,
  places: CollectedPlace[],
  selectedKeys: string[],
) {
  if (selectedKeys.length === 0) return []
  const placeMap = new Map(places.map((p) => [p.id, p]))
  return stops.filter((s) => {
    const collected = placeMap.get(s.placeId)
    if (!collected) return false
    return placeMatchesTypeFilter(collected.place, selectedKeys)
  })
}

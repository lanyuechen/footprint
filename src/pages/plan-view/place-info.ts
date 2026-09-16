import type { PlaceInfo } from '../../types'

export function formatPlaceType(type?: string) {
  if (!type) return ''
  return type
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}

export function placeInfoRows(place: PlaceInfo) {
  const rows: Array<{ label: string; value: string }> = []
  const type = formatPlaceType(place.type)
  if (type) rows.push({ label: '类型', value: type })
  const business = place.business
  if (!business) return rows
  if (business.alias) rows.push({ label: '别名', value: business.alias })
  if (business.businessArea) {
    rows.push({ label: '商圈', value: business.businessArea })
  }
  if (business.rating) rows.push({ label: '评分', value: business.rating })
  if (business.cost) rows.push({ label: '人均', value: business.cost })
  if (business.tag) rows.push({ label: '特色', value: business.tag })
  if (business.openTimeToday) {
    rows.push({ label: '今日营业', value: business.openTimeToday })
  }
  if (business.openTimeWeek) {
    rows.push({ label: '营业时间', value: business.openTimeWeek })
  }
  if (business.tel) rows.push({ label: '电话', value: business.tel })
  if (business.parkingType) {
    rows.push({ label: '停车场', value: business.parkingType })
  }
  return rows
}

export function isSamePlace(a: PlaceInfo, b: PlaceInfo): boolean {
  if (a.poiId && b.poiId) return a.poiId === b.poiId
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6 &&
    a.name === b.name
  )
}

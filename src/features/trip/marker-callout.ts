import type { PlaceInfo } from '../../types'

/** 地图 marker 选中后展示名称气泡 */
export function placeMarkerCallout(place: Pick<PlaceInfo, 'name'>) {
  return {
    content: place.name?.trim() || '未命名地点',
    color: '#1f2329',
    fontSize: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8ecef',
    bgColor: '#ffffff',
    padding: 8,
    display: 'ALWAYS' as const,
    textAlign: 'center' as const,
  }
}

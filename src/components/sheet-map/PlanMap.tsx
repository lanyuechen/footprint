import { Map } from '@tarojs/components'
import { memo, type MutableRefObject, type ReactNode } from 'react'
import type { MapRegionChangeEvent } from './types'

export type PlanMapProps = {
  mapId: string
  /** 用户拖/缩放期间为 true：冻结重渲染，避免受控 lat/lng 把拖动拽回去 */
  gesturingRef: MutableRefObject<boolean>
  latitude: number
  longitude: number
  scale: number
  markers: Array<Record<string, unknown>>
  polyline?: Array<Record<string, unknown>>
  className?: string
  showLocation?: boolean
  onRegionChange: (e: MapRegionChangeEvent) => void
  onMarkertap?: (e: { detail: { markerId: number | string } }) => void
  onPoiTap?: (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => void
  onClick?: () => void
  children?: ReactNode
}

/** 隔离无关 setState；手势中完全跳过重渲染 */
export const PlanMap = memo(
  function PlanMap({
    mapId,
    gesturingRef: _gesturingRef,
    latitude,
    longitude,
    scale,
    markers,
    polyline,
    className = 'sheet-map__map',
    showLocation = true,
    onRegionChange,
    onMarkertap,
    onPoiTap,
    onClick,
  }: PlanMapProps) {
    void _gesturingRef
    return (
      <Map
        id={mapId}
        className={className}
        latitude={latitude}
        longitude={longitude}
        scale={scale}
        markers={markers as never}
        polyline={polyline as never}
        showLocation={showLocation}
        onRegionChange={onRegionChange as never}
        onMarkerTap={onMarkertap as never}
        onPoiTap={onPoiTap as never}
        onClick={onClick as never}
        onError={() => {}}
      />
    )
  },
  (prev, next) => {
    if (next.gesturingRef.current) return true
    return (
      prev.mapId === next.mapId &&
      prev.latitude === next.latitude &&
      prev.longitude === next.longitude &&
      prev.scale === next.scale &&
      prev.markers === next.markers &&
      prev.polyline === next.polyline &&
      prev.className === next.className &&
      prev.showLocation === next.showLocation &&
      prev.onRegionChange === next.onRegionChange &&
      prev.onMarkertap === next.onMarkertap &&
      prev.onPoiTap === next.onPoiTap &&
      prev.onClick === next.onClick
    )
  },
)

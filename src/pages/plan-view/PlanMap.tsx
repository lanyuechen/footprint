import { Map } from '@tarojs/components'
import { memo } from 'react'

export const PLAN_MAP_ID = 'plan-view-map'

type PlanMapProps = {
  latitude: number
  longitude: number
  scale: number
  markers: Array<Record<string, unknown>>
  onRegionChange: (e: {
    type?: string
    causedBy?: string
    detail?: Record<string, unknown>
  }) => void
  onMarkertap: (e: { detail: { markerId: number | string } }) => void
  onPoiTap: (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => void
  onClick: () => void
}

/** 用户拖/缩放地图期间为 true：冻结 PlanMap 重渲染，避免受控 lat/lng 把拖动拽回去 */
export const mapUserGesturingRef = { current: false }

/** 隔离无关 setState；手势中完全跳过重渲染 */
export const PlanMap = memo(
  function PlanMap({
    latitude,
    longitude,
    scale,
    markers,
    onRegionChange,
    onMarkertap,
    onPoiTap,
    onClick,
  }: PlanMapProps) {
    return (
      <Map
        id={PLAN_MAP_ID}
        className='map-stage__map'
        latitude={latitude}
        longitude={longitude}
        scale={scale}
        markers={markers as never}
        showLocation
        onRegionChange={onRegionChange as never}
        onMarkerTap={onMarkertap}
        onPoiTap={onPoiTap}
        onClick={onClick}
        onError={() => {}}
      />
    )
  },
  (prev, next) => {
    if (mapUserGesturingRef.current) return true
    return (
      prev.latitude === next.latitude &&
      prev.longitude === next.longitude &&
      prev.scale === next.scale &&
      prev.markers === next.markers &&
      prev.onRegionChange === next.onRegionChange &&
      prev.onMarkertap === next.onMarkertap &&
      prev.onPoiTap === next.onPoiTap &&
      prev.onClick === next.onClick
    )
  },
)

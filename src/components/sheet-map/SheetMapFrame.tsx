import { View } from '@tarojs/components'
import type { ReactNode } from 'react'
import { useRef } from 'react'
import { PlanMap } from './PlanMap'
import type { UseSheetMapCameraResult } from './useSheetMapCamera'
import type { UseSheetDragResult } from './useSheetDrag'
import type { MapRegionChangeEvent, SheetPos } from './types'

export type SheetMapFrameProps = {
  mapId: string
  camera: UseSheetMapCameraResult
  sheet: UseSheetDragResult
  sheetPos: SheetPos
  markers: Array<Record<string, unknown>>
  polyline?: Array<Record<string, unknown>>
  className?: string
  mapClassName?: string
  sheetClassName?: string
  grabClassName?: string
  showLocation?: boolean
  header?: ReactNode
  /** 抓手区下方、列表上方（如搜索框），不参与拖拽手势 */
  subHeader?: ReactNode
  body?: ReactNode
  onMarkerTap?: (e: { detail: { markerId: number | string } }) => void
  onPoiTap?: (e: {
    detail: { name?: string; latitude?: number; longitude?: number }
  }) => void
  onMapClick?: () => void
}

export function SheetMapFrame({
  mapId,
  camera,
  sheet,
  sheetPos,
  markers,
  polyline,
  className = 'sheet-map',
  mapClassName = 'sheet-map__map',
  sheetClassName,
  grabClassName = 'sheet-map__grab',
  showLocation = true,
  header,
  subHeader,
  body,
  onMarkerTap,
  onPoiTap,
  onMapClick,
}: SheetMapFrameProps) {
  const onRegionChangeRef = useRef(camera.onRegionChange)
  onRegionChangeRef.current = camera.onRegionChange
  const onMarkerTapRef = useRef(onMarkerTap)
  onMarkerTapRef.current = onMarkerTap
  const onPoiTapRef = useRef(onPoiTap)
  onPoiTapRef.current = onPoiTap
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  const stableOnRegionChange = useRef((e: MapRegionChangeEvent) => {
    onRegionChangeRef.current(e)
  }).current
  const stableOnMarkertap = useRef(
    (e: { detail: { markerId: number | string } }) => {
      onMarkerTapRef.current?.(e)
    },
  ).current
  const stableOnPoiTap = useRef(
    (e: {
      detail: { name?: string; latitude?: number; longitude?: number }
    }) => {
      onPoiTapRef.current?.(e)
    },
  ).current
  const stableOnClick = useRef(() => {
    onMapClickRef.current?.()
  }).current

  const resolvedSheetClass = [
    sheetClassName,
    `sheet-map__sheet--${sheetPos}`,
    sheet.sheetDragging ? 'sheet-map__sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <View className={className}>
      <PlanMap
        mapId={mapId}
        gesturingRef={camera.gesturingRef}
        latitude={camera.mapCenter.latitude}
        longitude={camera.mapCenter.longitude}
        scale={camera.mapScale}
        markers={markers}
        polyline={polyline}
        className={mapClassName}
        showLocation={showLocation}
        onRegionChange={stableOnRegionChange}
        onMarkertap={onMarkerTap ? stableOnMarkertap : undefined}
        onPoiTap={onPoiTap ? stableOnPoiTap : undefined}
        onClick={onMapClick ? stableOnClick : undefined}
      />

      <View
        className={resolvedSheetClass}
        style={
          sheet.dragHeightPx != null
            ? { height: `${sheet.dragHeightPx}px` }
            : undefined
        }
      >
        <View
          className={grabClassName}
          catchMove
          onTouchStart={sheet.onSheetTouchStart as never}
          onTouchMove={sheet.onSheetTouchMove as never}
          onTouchEnd={sheet.onSheetTouchEnd as never}
          onTouchCancel={sheet.onSheetTouchEnd as never}
        >
          {header}
        </View>
        {subHeader}
        {sheet.showSheetBody ? body : null}
      </View>
    </View>
  )
}

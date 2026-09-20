/** 底栏三档位置 */
export type SheetPos = 'bottom' | 'middle' | 'top'

export type MapCoord = {
  latitude: number
  longitude: number
}

export type MapRegionChangeEvent = {
  type?: string
  causedBy?: string
  detail?: Record<string, unknown>
}

/** @deprecated 请从 `../../components/sheet-map` 导入；此处保留兼容 */
export {
  DEFAULT_CENTER,
  SEARCH_DEBOUNCE_MS,
  MARKER_ID_SEARCH,
  MAP_CENTER_EASE_MS,
  getWindowMetrics,
  sheetHeightPx,
  coverRatioFromSheetHeight,
  easeOutCubic,
  nearlySameCoord,
  estimateMapLatSpan,
  readLatSpanFromRegion,
  offsetCenterForSheet,
  reverseOffsetCenterForSheet,
  fitMapToPoints,
} from '../../components/sheet-map'
export type { SheetHeightOptions } from '../../components/sheet-map'
import type { MapUiMode } from './types'
import type { SheetPos } from '../../components/sheet-map'

export function mapUiToSheetPos(
  mapUi: MapUiMode,
  leavingSearch: boolean,
): SheetPos {
  if (leavingSearch) return 'bottom'
  if (mapUi === 'searching') return 'top'
  if (mapUi === 'preview') return 'middle'
  return 'bottom'
}

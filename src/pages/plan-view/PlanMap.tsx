/** @deprecated 请从 `../../components/sheet-map` 导入；此处保留兼容 */
export { PlanMap } from '../../components/sheet-map'
export type { PlanMapProps } from '../../components/sheet-map'

/** 历史默认 map id；新代码请显式传入 mapId */
export const PLAN_MAP_ID = 'plan-view-map'

/** @deprecated 全局单例已废弃；使用 useSheetMapCamera().gesturingRef */
export const mapUserGesturingRef = { current: false }

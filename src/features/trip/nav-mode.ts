import { Bike } from 'lucide-react-taro/icons/bike'
import { Bus } from 'lucide-react-taro/icons/bus'
import { Car } from 'lucide-react-taro/icons/car'
import { Footprints } from 'lucide-react-taro/icons/footprints'
import { Plane } from 'lucide-react-taro/icons/plane'
import { TrainFront } from 'lucide-react-taro/icons/train-front'
import { TramFront } from 'lucide-react-taro/icons/tram-front'
import type { NavMode } from '../../types'

type ModeIcon = typeof Footprints

export type NavModeMeta = {
  id: NavMode
  label: string
  Icon: ModeIcon
  color: string
}

/** 关键节点 / 行程可用的出行方式
 * 颜色与行程类型对齐：公交站 / 地铁站 / 机场 / 火车站
 */
export const KEY_NODE_TRAVEL_MODES: NavModeMeta[] = [
  { id: 'walking', label: '步行', Icon: Footprints, color: '#1a5f4a' },
  { id: 'driving', label: '驾驶', Icon: Car, color: '#0369a1' },
  { id: 'bus', label: '公交', Icon: Bus, color: '#c2410c' },
  { id: 'metro', label: '地铁', Icon: TramFront, color: '#7c3aed' },
  { id: 'rail', label: '高铁', Icon: TrainFront, color: '#1e3a8a' },
  { id: 'riding', label: '骑行', Icon: Bike, color: '#0ea5e9' },
  { id: 'flight', label: '飞机', Icon: Plane, color: '#2563eb' },
]

/** 导航页可选方式 */
export const NAV_PAGE_MODES: NavModeMeta[] = [
  { id: 'walking', label: '步行', Icon: Footprints, color: '#1a5f4a' },
  { id: 'riding', label: '骑行', Icon: Bike, color: '#0ea5e9' },
  { id: 'driving', label: '驾驶', Icon: Car, color: '#0369a1' },
  { id: 'bus', label: '公交', Icon: Bus, color: '#c2410c' },
  { id: 'metro', label: '地铁', Icon: TramFront, color: '#7c3aed' },
  { id: 'rail', label: '高铁', Icon: TrainFront, color: '#1e3a8a' },
  { id: 'flight', label: '飞机', Icon: Plane, color: '#2563eb' },
]

/** 兼容旧数据 transit → bus */
export function normalizeNavMode(raw: unknown): NavMode | undefined {
  if (raw === 'transit') return 'bus'
  if (
    raw === 'walking' ||
    raw === 'riding' ||
    raw === 'driving' ||
    raw === 'bus' ||
    raw === 'metro' ||
    raw === 'flight' ||
    raw === 'rail'
  ) {
    return raw
  }
  return undefined
}

export function navModeMeta(mode?: NavMode | null): NavModeMeta {
  const id = normalizeNavMode(mode) || 'walking'
  return (
    KEY_NODE_TRAVEL_MODES.find((m) => m.id === id) || KEY_NODE_TRAVEL_MODES[0]!
  )
}

export function isTransitNavMode(mode: NavMode): boolean {
  return mode === 'bus' || mode === 'metro'
}

/** 地图上用虚线示意（飞机弧线 / 高铁直线） */
export function isDashNavMode(mode: NavMode): boolean {
  return mode === 'flight' || mode === 'rail'
}

/** 不走高德画路径，本地几何示意 */
export function isLocalGeomNavMode(mode: NavMode): boolean {
  return mode === 'flight' || mode === 'rail'
}

/** 从备注中提取可能的车次（G/D/C/Z/T/K 等） */
export function extractTripHints(note?: string | null): string[] {
  if (!note || !note.trim()) return []
  const re = /[GDCZTKYLSgdcztkyls]\d{1,4}/g
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of note.matchAll(re)) {
    const t = m[0]!.toUpperCase()
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 高德公交换乘 strategy（v3）：公交避开地铁；地铁用最快捷（通常偏地铁） */
export function transitStrategyForMode(mode: NavMode): number {
  if (mode === 'metro') return 0
  if (mode === 'bus') return 5
  return 0
}

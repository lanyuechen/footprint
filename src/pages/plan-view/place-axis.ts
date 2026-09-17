import type { PlaceInfo } from '../../types'
import { Banknote } from 'lucide-react-taro/icons/banknote'
import { Bike } from 'lucide-react-taro/icons/bike'
import { Building } from 'lucide-react-taro/icons/building'
import { Building2 } from 'lucide-react-taro/icons/building-2'
import { Bus } from 'lucide-react-taro/icons/bus'
import { Car } from 'lucide-react-taro/icons/car'
import { CircleParking } from 'lucide-react-taro/icons/circle-parking'
import { Dumbbell } from 'lucide-react-taro/icons/dumbbell'
import { GraduationCap } from 'lucide-react-taro/icons/graduation-cap'
import { Hospital } from 'lucide-react-taro/icons/hospital'
import { Hotel } from 'lucide-react-taro/icons/hotel'
import { Landmark } from 'lucide-react-taro/icons/landmark'
import { MapPin } from 'lucide-react-taro/icons/map-pin'
import { Mountain } from 'lucide-react-taro/icons/mountain'
import { Plane } from 'lucide-react-taro/icons/plane'
import { ShoppingBag } from 'lucide-react-taro/icons/shopping-bag'
import { Ship } from 'lucide-react-taro/icons/ship'
import { Store } from 'lucide-react-taro/icons/store'
import { Ticket } from 'lucide-react-taro/icons/ticket'
import { TrainFront } from 'lucide-react-taro/icons/train-front'
import { TramFront } from 'lucide-react-taro/icons/tram-front'
import { Trees } from 'lucide-react-taro/icons/trees'
import { Utensils } from 'lucide-react-taro/icons/utensils'
import { Wrench } from 'lucide-react-taro/icons/wrench'

type AxisIcon = typeof MapPin
/** 针脚文件名，对应 src/assets/markers。新增后运行 npm run markers 出图 */
export type AxisMark = { icon: AxisIcon; color: string; marker: string }

const AXIS_DEFAULT: AxisMark = { icon: MapPin, color: '#1a5f4a', marker: 'map-pin' }

/** 把类型色混入白色，作为图标底衬 */
export function lightenColor(hex: string, mix = 0.82) {
  const n = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  const mixed = channels.map((c) => Math.round(c + (255 - c) * mix))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** 高德大类编码前两位 → 时间轴图标和颜色 */
const PLACE_MAJOR_MARKS: Record<string, AxisMark> = {
  '01': { icon: Car, color: '#0ea5e9', marker: 'car' },
  '02': { icon: Car, color: '#0ea5e9', marker: 'car' },
  '03': { icon: Wrench, color: '#d97706', marker: 'wrench' },
  '04': { icon: Bike, color: '#06b6d4', marker: 'bike' },
  '05': { icon: Utensils, color: '#f97316', marker: 'utensils' },
  '06': { icon: ShoppingBag, color: '#ec4899', marker: 'shopping-bag' },
  '07': { icon: Store, color: '#14b8a6', marker: 'store' },
  '08': { icon: Dumbbell, color: '#22c55e', marker: 'dumbbell' },
  '09': { icon: Hospital, color: '#ef4444', marker: 'hospital' },
  '10': { icon: Hotel, color: '#8b5cf6', marker: 'hotel' },
  '11': { icon: Mountain, color: '#10b981', marker: 'mountain' },
  '12': { icon: Building2, color: '#64748b', marker: 'building-2' },
  '13': { icon: Landmark, color: '#3b82f6', marker: 'landmark' },
  '14': { icon: GraduationCap, color: '#6366f1', marker: 'graduation-cap' },
  '16': { icon: Banknote, color: '#eab308', marker: 'banknote' },
  '17': { icon: Building, color: '#78716c', marker: 'building' },
  '22': { icon: Ticket, color: '#f43f5e', marker: 'ticket' },
}

/** 交通设施按中类再分 */
const PLACE_TRANSIT_MARKS: Record<string, AxisMark> = {
  '1501': { icon: Plane, color: '#2563eb', marker: 'plane' },
  '1502': { icon: TrainFront, color: '#1e3a8a', marker: 'train-front' },
  '1503': { icon: Ship, color: '#0e7490', marker: 'ship' },
  '1504': { icon: Bus, color: '#c2410c', marker: 'bus' },
  '1505': { icon: TramFront, color: '#7c3aed', marker: 'tram-front' },
  '1506': { icon: TramFront, color: '#7c3aed', marker: 'tram-front' },
  '1507': { icon: Bus, color: '#c2410c', marker: 'bus' },
  '1509': { icon: CircleParking, color: '#57534e', marker: 'circle-parking' },
}

const PLACE_PARK_MARK: AxisMark = { icon: Trees, color: '#84cc16', marker: 'trees' }

export function placeAxisMark(place: PlaceInfo): AxisMark {
  const code = (place.typecode || '').split('|')[0].replace(/\D/g, '')
  const transit = PLACE_TRANSIT_MARKS[code.slice(0, 4)]
  if (transit) return transit
  if (code.slice(0, 4) === '1101') return PLACE_PARK_MARK
  const major = PLACE_MAJOR_MARKS[code.slice(0, 2)]
  if (major) return major

  const type = place.type || ''
  if (/机场/.test(type)) return PLACE_TRANSIT_MARKS['1501']
  if (/火车|高铁/.test(type)) return PLACE_TRANSIT_MARKS['1502']
  if (/地铁|轻轨/.test(type)) return PLACE_TRANSIT_MARKS['1505']
  if (/公交|汽车站/.test(type)) return PLACE_TRANSIT_MARKS['1507']
  if (/港口|码头|轮渡/.test(type)) return PLACE_TRANSIT_MARKS['1503']
  if (/停车/.test(type)) return PLACE_TRANSIT_MARKS['1509']
  if (/餐饮|美食|餐厅/.test(type)) return PLACE_MAJOR_MARKS['05']
  if (/酒店|宾馆|住宿/.test(type)) return PLACE_MAJOR_MARKS['10']
  if (/购物|商场|超市/.test(type)) return PLACE_MAJOR_MARKS['06']
  if (/医院|医疗|诊所/.test(type)) return PLACE_MAJOR_MARKS['09']
  if (/学校|大学|科教/.test(type)) return PLACE_MAJOR_MARKS['14']
  if (/公园/.test(type)) return PLACE_PARK_MARK
  if (/风景|景点|名胜/.test(type)) return PLACE_MAJOR_MARKS['11']
  if (/政府/.test(type)) return PLACE_MAJOR_MARKS['13']
  return AXIS_DEFAULT
}

/** 小程序包内路径。文件由 copy 拷到 dist/assets/markers */
export function markerIconPath(place: PlaceInfo) {
  return `/assets/markers/${placeAxisMark(place).marker}.png`
}

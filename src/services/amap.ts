import Taro from '@tarojs/taro'
import { AMAP_CONFIG } from '../constants'
import type { AmapPoi, PlaceInfo } from '../types'

export interface UserLocation {
  latitude: number
  longitude: number
}

function isPlaceholderKey(key: string): boolean {
  return !key || key.startsWith('YOUR_')
}

function parseLocation(location: string): { longitude: number; latitude: number } {
  const [lng, lat] = location.split(',').map(Number)
  return { longitude: lng, latitude: lat }
}

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function sortByDistance(places: PlaceInfo[], center?: UserLocation | null): PlaceInfo[] {
  if (!center) return places
  return [...places].sort(
    (x, y) =>
      distanceMeters(center, { latitude: x.latitude, longitude: x.longitude }) -
      distanceMeters(center, { latitude: y.latitude, longitude: y.longitude }),
  )
}

export function poiToPlace(poi: AmapPoi): PlaceInfo {
  const { longitude, latitude } = parseLocation(poi.location)
  const addressParts = [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean)
  return {
    poiId: poi.id,
    name: poi.name,
    address: addressParts.join('') || poi.address || '',
    latitude,
    longitude,
    city: poi.cityname,
  }
}

/** Key 未配置时返回演示数据，方便本地联调 UI */
const MOCK_PLACES: PlaceInfo[] = [
  {
    poiId: 'mock_west_lake',
    name: '西湖',
    address: '浙江省杭州市西湖区龙井路1号',
    latitude: 30.24295,
    longitude: 120.14855,
    city: '杭州市',
  },
  {
    poiId: 'mock_lingyin',
    name: '灵隐寺',
    address: '浙江省杭州市西湖区法云弄1号',
    latitude: 30.2428,
    longitude: 120.1007,
    city: '杭州市',
  },
  {
    poiId: 'mock_leifeng',
    name: '雷峰塔',
    address: '浙江省杭州市西湖区南山路15号',
    latitude: 30.2312,
    longitude: 120.1486,
    city: '杭州市',
  },
  {
    poiId: 'mock_forbidden_city',
    name: '故宫博物院',
    address: '北京市东城区景山前街4号',
    latitude: 39.916345,
    longitude: 116.397155,
    city: '北京市',
  },
  {
    poiId: 'mock_oriental_pearl',
    name: '东方明珠',
    address: '上海市浦东新区世纪大道1号',
    latitude: 31.2397,
    longitude: 121.4998,
    city: '上海市',
  },
]

function searchMockPlaces(keyword: string, location?: UserLocation | null): PlaceInfo[] {
  const q = keyword.trim().toLowerCase()
  const filtered = MOCK_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q),
  )
  const list = filtered.length > 0 ? filtered : MOCK_PLACES
  return sortByDistance(list, location)
}

async function requestPois(url: string): Promise<PlaceInfo[]> {
  const res = await Taro.request<{
    status: string
    info: string
    pois?: AmapPoi[]
  }>({
    url,
    method: 'GET',
  })

  if (res.data?.status !== '1') {
    throw new Error(res.data?.info || '搜索失败')
  }

  return (res.data.pois || [])
    .filter((p) => p.location)
    .map(poiToPlace)
}

/**
 * 关键字搜索：优先附近匹配，再补全国结果
 * - 有定位：先周边搜索，不足时用全国文本搜索（带 location 按距离排序）合并去重
 * - 无定位：全国文本搜索
 */
export async function searchPlaces(
  keyword: string,
  location?: UserLocation | null,
): Promise<PlaceInfo[]> {
  const q = keyword.trim()
  if (!q) return []

  const key = AMAP_CONFIG.webServiceKey
  if (isPlaceholderKey(key)) {
    return searchMockPlaces(q, location)
  }

  const merged: PlaceInfo[] = []
  const seen = new Set<string>()

  const pushUnique = (list: PlaceInfo[]) => {
    list.forEach((p) => {
      const id = p.poiId || `${p.name}_${p.longitude}_${p.latitude}`
      if (seen.has(id)) return
      seen.add(id)
      merged.push(p)
    })
  }

  if (location) {
    const aroundUrl =
      `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
      `&location=${location.longitude},${location.latitude}` +
      `&keywords=${encodeURIComponent(q)}` +
      `&radius=20000&offset=20&page=1&extensions=base`
    try {
      pushUnique(await requestPois(aroundUrl))
    } catch {
      // 周边失败则继续全国搜索
    }
  }

  if (merged.length < 10) {
    let textUrl =
      `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}` +
      `&keywords=${encodeURIComponent(q)}` +
      `&city=&children=0&offset=20&page=1&extensions=base`
    if (location) {
      textUrl += `&location=${location.longitude},${location.latitude}`
    }
    pushUnique(await requestPois(textUrl))
  }

  return sortByDistance(merged, location).slice(0, 20)
}

/** 获取当前位置，失败返回 null */
export async function getUserLocation(): Promise<UserLocation | null> {
  try {
    const res = await Taro.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
    })
    return { latitude: res.latitude, longitude: res.longitude }
  } catch {
    return null
  }
}

export function getAmapMapKey(): string {
  return AMAP_CONFIG.key
}

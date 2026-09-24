import Taro from '@tarojs/taro'
import { AMAP_CONFIG, STORAGE_KEYS } from '../constants'
import type {
  AmapPoi,
  NavMode,
  NavRoute,
  NavRoutePoint,
  NavRouteStep,
  PlaceBusiness,
  PlaceInfo,
} from '../types'

export interface UserLocation {
  latitude: number
  longitude: number
}

function isPlaceholderKey(key: string): boolean {
  return !key || key.startsWith('YOUR_')
}

/** 高德部分字段无值时会返回 []，需先规范化成字符串 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function parseLocation(location: string): { longitude: number; latitude: number } | null {
  const parts = location.split(',')
  if (parts.length < 2) return null
  const longitude = Number(parts[0])
  const latitude = Number(parts[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  return { longitude, latitude }
}

function formatLocation(loc: UserLocation): string {
  return `${loc.longitude.toFixed(6)},${loc.latitude.toFixed(6)}`
}

export function distanceMeters(
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

function parseApiDistance(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined
  if (Array.isArray(raw)) return undefined
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asText(value).trim()
    if (text && text !== '[]') return text
  }
  return undefined
}

function readBusiness(poi: AmapPoi): PlaceBusiness | undefined {
  const biz =
    poi.business && typeof poi.business === 'object' ? poi.business : {}
  const ext =
    poi.biz_ext && typeof poi.biz_ext === 'object' ? poi.biz_ext : {}
  const business: PlaceBusiness = {
    businessArea: pickText(biz.business_area, poi.business_area),
    openTimeToday: pickText(biz.opentime_today),
    openTimeWeek: pickText(biz.opentime_week),
    tel: pickText(biz.tel, poi.tel),
    tag: pickText(biz.tag),
    rating: pickText(biz.rating, ext.rating),
    cost: pickText(biz.cost, ext.cost),
    parkingType: pickText(biz.parking_type),
    alias: pickText(biz.alias),
  }
  return Object.values(business).some(Boolean) ? business : undefined
}

export function poiToPlace(
  poi: AmapPoi,
  from?: UserLocation | null,
): PlaceInfo | null {
  const loc = parseLocation(asText(poi.location))
  if (!loc) return null
  const addressParts = [
    asText(poi.pname),
    asText(poi.cityname),
    asText(poi.adname),
    asText(poi.address),
  ].filter(Boolean)

  const apiDistance = parseApiDistance(poi.distance)
  const computed =
    from != null
      ? distanceMeters(from, { latitude: loc.latitude, longitude: loc.longitude })
      : undefined

  const type = pickText(poi.type)
  const typecode = pickText(poi.typecode)
  const business = readBusiness(poi)

  return {
    poiId: asText(poi.id) || undefined,
    name: asText(poi.name) || '未知地点',
    address: addressParts.join('') || asText(poi.address),
    latitude: loc.latitude,
    longitude: loc.longitude,
    city: asText(poi.cityname) || undefined,
    distanceMeters: apiDistance ?? computed,
    type,
    typecode,
    business,
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
    type: '风景名胜;风景名胜相关;旅游景点',
    typecode: '110000',
    business: { rating: '4.8', cost: '免费', alias: '西子湖' },
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

function searchMockPlaces(
  keyword: string,
  location?: UserLocation | null,
): PlaceInfo[] {
  const q = keyword.trim().toLowerCase()
  const filtered = MOCK_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q),
  )
  const list = (filtered.length > 0 ? filtered : MOCK_PLACES).map((p) => ({
    ...p,
    distanceMeters: location
      ? distanceMeters(location, {
          latitude: p.latitude,
          longitude: p.longitude,
        })
      : undefined,
  }))
  // 名称更贴合关键字的排前面，贴近「匹配程度」
  return list.sort((a, b) => {
    const aExact = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().includes(q) ? 1 : 2
    const bExact = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().includes(q) ? 1 : 2
    return aExact - bExact
  })
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  if (err && typeof err === 'object') {
    const anyErr = err as { errMsg?: string; message?: string }
    if (anyErr.errMsg) return anyErr.errMsg
    if (anyErr.message) return anyErr.message
  }
  return '搜索失败'
}

function explainRequestError(raw: string): string {
  const msg = raw || '搜索失败'
  if (
    msg.includes('url not in domain list') ||
    msg.includes('不在以下 request 合法域名') ||
    msg.includes('domain list')
  ) {
    return '未配置合法域名：请在微信公众平台将 https://restapi.amap.com 加入 request 合法域名；开发阶段可在开发者工具勾选「不校验合法域名」'
  }
  if (msg.includes('request:fail')) {
    return `网络请求失败：${msg}`
  }
  return msg
}

async function requestPois(
  url: string,
  from?: UserLocation | null,
): Promise<PlaceInfo[]> {
  let res: Taro.request.SuccessCallbackResult<unknown>

  try {
    res = await Taro.request({
      url,
      method: 'GET',
      timeout: 15000,
      dataType: 'json',
    })
  } catch (err) {
    throw new Error(explainRequestError(extractErrorMessage(err)))
  }

  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`请求异常(HTTP ${res.statusCode})`)
  }

  let data = res.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      throw new Error(`高德返回非 JSON：${data.slice(0, 80)}`)
    }
  }

  if (!data || typeof data !== 'object') {
    throw new Error('未拿到高德返回数据，请稍后重试')
  }

  const payload = data as {
    status?: string | number
    info?: string
    infocode?: string
    pois?: AmapPoi[] | string
  }

  const status = String(payload.status ?? '')
  if (status !== '1') {
    const detail = payload.info || payload.infocode || '未知错误'
    throw new Error(`高德接口错误：${detail}`)
  }

  const pois = Array.isArray(payload.pois) ? payload.pois : []
  return pois
    .map((poi) => poiToPlace(poi, from))
    .filter((p): p is PlaceInfo => !!p)
}

export interface PlaceSearchOptions {
  /** 地图当前关注点。用来定城市，并让附近结果优先，对齐高德「当前城市」 */
  mapCenter?: UserLocation | null
  /** 用户定位。只用来算「距你」，不参与排序 */
  from?: UserLocation | null
}

interface SearchRegion {
  citycode: string
  /** 城市名；直辖市时 city 为空，这里会落到省名 */
  city: string
  adcode: string
}

const searchRegionCache = new Map<string, SearchRegion>()

/** 输入提示 / 关键字搜索要用城市级区划，不能把区县 adcode 当城市 */
function cityScope(region: SearchRegion | null): string {
  if (!region) return ''
  if (region.citycode) return region.citycode
  if (region.adcode.length >= 4) return `${region.adcode.slice(0, 4)}00`
  return region.city
}

function looksLikeAddress(keyword: string): boolean {
  return /[0-9０-９]/.test(keyword) || /[路街巷弄号道村]/.test(keyword)
}

function tipToPlace(tip: Record<string, unknown>): PlaceInfo | null {
  const loc = parseLocation(asText(tip.location))
  const name = asText(tip.name).trim()
  if (!loc || !name) return null
  const district = asText(tip.district).trim()
  const address = asText(tip.address).trim()
  return {
    poiId: asText(tip.id) || undefined,
    name,
    address: [district, address].filter(Boolean).join('') || address,
    latitude: loc.latitude,
    longitude: loc.longitude,
    city: district || undefined,
    typecode: asText(tip.typecode) || undefined,
  }
}

function isSameSearchHit(a: PlaceInfo, b: PlaceInfo): boolean {
  if (a.poiId && b.poiId && a.poiId === b.poiId) return true
  return (
    distanceMeters(a, b) < 40 &&
    (a.name === b.name || a.name.includes(b.name) || b.name.includes(a.name))
  )
}

function withDistance(place: PlaceInfo, from?: UserLocation | null): PlaceInfo {
  if (!from) return place
  return {
    ...place,
    distanceMeters: distanceMeters(from, place),
  }
}

async function resolveSearchRegion(
  center: UserLocation,
  key: string,
): Promise<SearchRegion | null> {
  const cacheKey = `${center.latitude.toFixed(2)},${center.longitude.toFixed(2)}`
  const cached = searchRegionCache.get(cacheKey)
  if (cached) return cached

  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
    `&location=${formatLocation(center)}&extensions=base`
  const data = await requestJson(url)
  if (String(data.status ?? '') !== '1') return null
  const comp = (
    data.regeocode as { addressComponent?: Record<string, unknown> } | undefined
  )?.addressComponent
  const region: SearchRegion = {
    citycode: asText(comp?.citycode),
    city: asText(comp?.city) || asText(comp?.province),
    adcode: asText(comp?.adcode),
  }
  if (!region.citycode && !region.city && !region.adcode) return null
  searchRegionCache.set(cacheKey, region)
  return region
}

/** 搜索框输入提示。这是高德 App 下拉列表实际用的接口，必须带城市才会吃 location */
async function searchInputTips(
  keyword: string,
  key: string,
  region: SearchRegion | null,
  center?: UserLocation | null,
): Promise<PlaceInfo[]> {
  const city = cityScope(region)
  let url =
    `https://restapi.amap.com/v3/assistant/inputtips?key=${encodeURIComponent(key)}` +
    `&keywords=${encodeURIComponent(keyword)}` +
    `&datatype=poi|bus`
  if (city) url += `&city=${encodeURIComponent(city)}`
  if (center && city) url += `&location=${formatLocation(center)}`

  const data = await requestJson(url)
  if (String(data.status ?? '') !== '1') return []
  const tips = Array.isArray(data.tips) ? data.tips : []
  return tips
    .map((tip) =>
      tip && typeof tip === 'object'
        ? tipToPlace(tip as Record<string, unknown>)
        : null,
    )
    .filter((item): item is PlaceInfo => !!item)
}

/** 关键字搜索，只补输入提示没收录的结果，不本地重排 */
async function searchKeywordPlaces(
  keyword: string,
  key: string,
  region: SearchRegion | null,
): Promise<PlaceInfo[]> {
  const scope = cityScope(region)
  let textUrl =
    `https://restapi.amap.com/v5/place/text?key=${encodeURIComponent(key)}` +
    `&keywords=${encodeURIComponent(keyword)}` +
    `&page_size=20&page_num=1&show_fields=business`
  if (scope) textUrl += `&region=${encodeURIComponent(scope)}`

  try {
    const list = await requestPois(textUrl)
    if (list.length > 0) return list
  } catch {
    // v5 失败时回退 v3
  }

  let v3Url =
    `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}` +
    `&keywords=${encodeURIComponent(keyword)}` +
    `&offset=20&page=1&extensions=all`
  if (scope) v3Url += `&city=${encodeURIComponent(scope)}`
  return requestPois(v3Url)
}

/** 门牌、道路类关键词补一条地理编码，避免只剩周边 POI */
async function searchAddressPlace(
  keyword: string,
  key: string,
  region: SearchRegion | null,
): Promise<PlaceInfo | null> {
  if (keyword.length < 3 || !looksLikeAddress(keyword)) return null
  const scope = cityScope(region)
  let url =
    `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(key)}` +
    `&address=${encodeURIComponent(keyword)}`
  if (scope) url += `&city=${encodeURIComponent(scope)}`

  const data = await requestJson(url)
  if (String(data.status ?? '') !== '1') return null
  const geocodes = Array.isArray(data.geocodes) ? data.geocodes : []
  const hit = geocodes.find((item) => item && typeof item === 'object') as
    | Record<string, unknown>
    | undefined
  if (!hit) return null
  const level = asText(hit.level)
  if (
    !['门牌号', '单元号', '道路', '道路交叉路口', '兴趣点', '公交地铁站点'].includes(
      level,
    )
  ) {
    return null
  }
  const loc = parseLocation(asText(hit.location))
  if (!loc) return null
  if (region?.adcode && asText(hit.adcode).slice(0, 4) !== region.adcode.slice(0, 4)) {
    return null
  }
  const name = asText(hit.formatted_address).trim()
  if (!name) return null
  return {
    name,
    address: [asText(hit.province), asText(hit.city), asText(hit.district)]
      .filter(Boolean)
      .join(''),
    latitude: loc.latitude,
    longitude: loc.longitude,
    city: asText(hit.city) || asText(hit.province) || undefined,
  }
}

function mergeSearchHits(
  tips: PlaceInfo[],
  places: PlaceInfo[],
  address: PlaceInfo | null,
  from?: UserLocation | null,
): PlaceInfo[] {
  const richer = new Map<string, PlaceInfo>()
  for (const place of places) {
    if (place.poiId) richer.set(place.poiId, place)
  }

  const out: PlaceInfo[] = []
  const push = (place: PlaceInfo, preferIncomingName = false) => {
    if (out.some((item) => isSameSearchHit(item, place))) return
    const detail = place.poiId ? richer.get(place.poiId) : undefined
    const merged = detail
      ? {
          ...detail,
          name: preferIncomingName ? place.name : detail.name,
          address: place.address || detail.address,
          latitude: place.latitude,
          longitude: place.longitude,
        }
      : place
    out.push(withDistance(merged, from))
  }

  if (address && !tips.some((item) => isSameSearchHit(item, address))) {
    push(address, true)
  }
  for (const tip of tips) push(tip, true)
  for (const place of places) push(place)
  return out.slice(0, 20)
}

/**
 * 尽量对齐高德 App 搜索框：
 * - 排序以输入提示为准（App 下拉就是这套）
 * - 用地图所在城市做召回权重，不锁死本市，外地同名仍能出现
 * - 关键字搜索只补提示里没有的地点，且不按距离重排
 * - 手机定位只用来显示距离
 */
export async function searchPlaces(
  keyword: string,
  options?: PlaceSearchOptions | UserLocation | null,
): Promise<PlaceInfo[]> {
  const q = keyword.trim()
  if (!q) return []

  const opts: PlaceSearchOptions =
    options && 'latitude' in options
      ? { from: options, mapCenter: options }
      : options || {}
  const center = opts.mapCenter
  const from = opts.from

  const key = AMAP_CONFIG.webServiceKey
  if (isPlaceholderKey(key)) {
    return searchMockPlaces(q, from || center)
  }

  let region: SearchRegion | null = null
  if (center) {
    try {
      region = await resolveSearchRegion(center, key)
    } catch {
      region = null
    }
  }

  const [tipsResult, placesResult, addressResult] = await Promise.all([
    searchInputTips(q, key, region, center).catch(() => [] as PlaceInfo[]),
    searchKeywordPlaces(q, key, region).catch((err: unknown) => err),
    searchAddressPlace(q, key, region).catch(() => null),
  ])

  const places = Array.isArray(placesResult) ? placesResult : []
  const address = addressResult
  if (tipsResult.length === 0 && places.length === 0 && !address) {
    if (placesResult instanceof Error) throw placesResult
    return []
  }

  return mergeSearchHits(tipsResult, places, address, from)
}

/** 地图点名只认精确同名，避免「厂桥路口东」→「厂桥」、「北京四中」→「北京四中宿舍」 */
function normalizeMapName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

function pickNamedPlace(
  list: PlaceInfo[],
  name: string,
  coord: { latitude: number; longitude: number },
): PlaceInfo | null {
  const q = normalizeMapName(name)
  if (!q || list.length === 0) return null
  const ranked = list
    .filter((item) => normalizeMapName(item.name) === q)
    .map((item) => ({ item, dist: distanceMeters(coord, item) }))
  if (ranked.length === 0) return null
  ranked.sort((a, b) => a.dist - b.dist)
  return ranked[0]!.item
}

/** 腾讯底图点与高德 POI 坐标偏差超过该值时，保留点击坐标，避免地图跳动 */
const MAP_POI_SNAP_MAX_METERS = 80

function anchorPlaceToTap(
  place: PlaceInfo,
  tap: { latitude: number; longitude: number },
): PlaceInfo {
  const dist = distanceMeters(tap, place)
  if (dist <= MAP_POI_SNAP_MAX_METERS) return place
  return {
    ...place,
    latitude: tap.latitude,
    longitude: tap.longitude,
  }
}

/** 无精确同名时：保留底图点名与点击坐标，只补地址等字段 */
function enrichTapPlace(
  tapName: string,
  tap: { latitude: number; longitude: number },
  nearby: PlaceInfo[],
  formattedAddress?: string,
): PlaceInfo | null {
  const sorted = [...nearby].sort(
    (a, b) => distanceMeters(tap, a) - distanceMeters(tap, b),
  )
  const nearest = sorted[0]
  const address =
    asText(nearest?.address) || asText(formattedAddress)
  if (!nearest && !address) return null
  return {
    ...(nearest || {
      name: tapName,
      address: '',
      latitude: tap.latitude,
      longitude: tap.longitude,
    }),
    name: tapName,
    address: address || nearest?.address || '',
    latitude: tap.latitude,
    longitude: tap.longitude,
  }
}

async function requestAmapJson(url: string): Promise<Record<string, unknown>> {
  const res = await Taro.request({
    url,
    method: 'GET',
    timeout: 15000,
    dataType: 'json',
  })
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`请求异常(HTTP ${res.statusCode})`)
  }
  let data = res.data
  if (typeof data === 'string') data = JSON.parse(data)
  if (!data || typeof data !== 'object') throw new Error('未拿到高德返回数据')
  const payload = data as Record<string, unknown>
  if (String(payload.status ?? '') !== '1') {
    throw new Error(`高德接口错误：${payload.info || payload.infocode || '未知错误'}`)
  }
  return payload
}

async function lookupPlaceDetail(
  key: string,
  poiId: string,
  coord: { latitude: number; longitude: number },
): Promise<PlaceInfo | null> {
  const url =
    `https://restapi.amap.com/v5/place/detail?key=${encodeURIComponent(key)}` +
    `&id=${encodeURIComponent(poiId)}&show_fields=business`
  try {
    const list = await requestPois(url, coord)
    return list[0] || null
  } catch {
    return null
  }
}

/**
 * 地图点只带回名称和坐标。用周边检索 / 逆地理补齐地址、类型和商业信息。
 */
export async function lookupMapPlace(
  name: string,
  coord: { latitude: number; longitude: number },
): Promise<PlaceInfo | null> {
  const q = name.trim()
  const key = AMAP_CONFIG.webServiceKey
  if (!q || isPlaceholderKey(key)) return null

  const location = formatLocation(coord)
  const keyword = encodeURIComponent(q)
  const aroundUrls = [
    `https://restapi.amap.com/v5/place/around?key=${encodeURIComponent(key)}` +
      `&keywords=${keyword}&location=${location}` +
      `&radius=500&sortrule=distance&page_size=10&page_num=1&show_fields=business`,
    `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}` +
      `&keywords=${keyword}&location=${location}` +
      `&radius=500&sortrule=distance&offset=10&page=1&extensions=all`,
  ]

  for (const url of aroundUrls) {
    try {
      const list = await requestPois(url, coord)
      const matched = pickNamedPlace(list, q, coord)
      if (matched) return anchorPlaceToTap(matched, coord)
    } catch {
      // 换下一个接口
    }
  }

  try {
    const payload = await requestAmapJson(
      `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
        `&location=${location}&extensions=all&radius=200&poitype=&roadlevel=0`,
    )
    const regeocode = payload.regeocode as
      | { pois?: AmapPoi[]; formatted_address?: string }
      | undefined
    const pois = Array.isArray(regeocode?.pois) ? regeocode.pois : []
    const poiPlaces = pois
      .map((poi) => poiToPlace(poi, coord))
      .filter((p): p is PlaceInfo => !!p)
    const matched = pickNamedPlace(poiPlaces, q, coord)
    if (matched) {
      const poiId = matched.poiId
      if (poiId) {
        const detailed = await lookupPlaceDetail(key, poiId, coord)
        if (detailed) return anchorPlaceToTap(detailed, coord)
      }
      return anchorPlaceToTap(matched, coord)
    }
    // 无同名 POI：保留底图点名，只补地址等
    return enrichTapPlace(q, coord, poiPlaces, asText(regeocode?.formatted_address))
  } catch {
    return null
  }
}

/**
 * 地图空白点击：无 POI 名，逆地理补地址，坐标始终用点击点。
 */
export async function lookupMapCoord(
  coord: { latitude: number; longitude: number },
): Promise<PlaceInfo | null> {
  const key = AMAP_CONFIG.webServiceKey
  if (isPlaceholderKey(key)) return null

  const location = formatLocation(coord)
  const fallback: PlaceInfo = {
    name: '地图选点',
    address: '',
    latitude: coord.latitude,
    longitude: coord.longitude,
  }

  try {
    const payload = await requestAmapJson(
      `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
        `&location=${location}&extensions=all&radius=200&poitype=&roadlevel=0`,
    )
    const regeocode = payload.regeocode as
      | { pois?: AmapPoi[]; formatted_address?: string }
      | undefined
    const pois = Array.isArray(regeocode?.pois) ? regeocode.pois : []
    const poiPlaces = pois
      .map((poi) => poiToPlace(poi, coord))
      .filter((p): p is PlaceInfo => !!p)
    return (
      enrichTapPlace(
        '地图选点',
        coord,
        poiPlaces,
        asText(regeocode?.formatted_address),
      ) || fallback
    )
  } catch {
    return fallback
  }
}

/** 获取当前位置，失败返回 null */
export async function getUserLocation(): Promise<UserLocation | null> {
  try {
    const res = await Taro.getLocation({
      type: 'gcj02',
    })
    return { latitude: res.latitude, longitude: res.longitude }
  } catch {
    return null
  }
}

export function getAmapMapKey(): string {
  return AMAP_CONFIG.key
}

export const NAV_MODES: Array<{ id: NavMode; label: string }> = [
  { id: 'walking', label: '步行' },
  { id: 'riding', label: '骑行' },
  { id: 'transit', label: '公交' },
]

export function getLastNavMode(): NavMode {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.LAST_NAV_MODE)
    if (raw === 'walking' || raw === 'riding' || raw === 'transit') return raw
  } catch {
    // ignore
  }
  return 'walking'
}

export function setLastNavMode(mode: NavMode) {
  try {
    Taro.setStorageSync(STORAGE_KEYS.LAST_NAV_MODE, mode)
  } catch {
    // ignore
  }
}

function parsePolyline(raw: unknown): NavRoutePoint[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const points: NavRoutePoint[] = []
  for (const seg of raw.split(';')) {
    const [lngStr, latStr] = seg.split(',')
    const longitude = Number(lngStr)
    const latitude = Number(latStr)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue
    points.push({ latitude, longitude })
  }
  return points
}

function appendPolyline(target: NavRoutePoint[], raw: unknown) {
  const pts = parsePolyline(raw)
  if (pts.length === 0) return
  if (target.length === 0) {
    target.push(...pts)
    return
  }
  const last = target[target.length - 1]
  const first = pts[0]
  const same =
    Math.abs(last.latitude - first.latitude) < 1e-7 &&
    Math.abs(last.longitude - first.longitude) < 1e-7
  target.push(...(same ? pts.slice(1) : pts))
}

function toNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function asStopName(stop: unknown): string {
  if (!stop || typeof stop !== 'object') return ''
  return asText((stop as { name?: unknown }).name)
}

function isMetroLine(type: string, name: string): boolean {
  const t = type || ''
  const n = name || ''
  return (
    t.includes('地铁') ||
    t.includes('轨') ||
    n.includes('地铁') ||
    n.includes('号线')
  )
}

function formatStepDistance(meters: number): string {
  if (!(meters > 0)) return ''
  if (meters < 1000) return `${Math.round(meters)}米`
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)}公里` : `${Math.round(km)}公里`
}

/** 分段地图着色（按顺序轮换，保证相邻段颜色不同） */
export const NAV_STEP_COLORS = [
  '#1a5f4a',
  '#2f6fed',
  '#c45656',
  '#d48806',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#52c41a',
  '#fa8c16',
  '#597ef7',
] as const

function stepColorAt(index: number): string {
  return NAV_STEP_COLORS[index % NAV_STEP_COLORS.length]
}

function collectPolylinePoints(raw: unknown): NavRoutePoint[] {
  return parsePolyline(raw)
}

function collectMergedPolylinePoints(raws: unknown[]): NavRoutePoint[] {
  const pts: NavRoutePoint[] = []
  for (const raw of raws) appendPolyline(pts, raw)
  return pts
}

function mockRoute(
  mode: NavMode,
  origin: UserLocation,
  destination: UserLocation,
): NavRoute {
  const dist = distanceMeters(origin, destination)
  const speed =
    mode === 'walking' ? 1.3 : mode === 'riding' ? 4 : 6 // m/s 粗估
  const kind = mode === 'walking' ? 'walk' : mode === 'riding' ? 'ride' : 'bus'
  const label = mode === 'walking' ? '步行' : mode === 'riding' ? '骑行' : '前往'
  const mid = {
    latitude: (origin.latitude + destination.latitude) / 2,
    longitude: (origin.longitude + destination.longitude) / 2,
  }
  const seg1 = [
    { latitude: origin.latitude, longitude: origin.longitude },
    mid,
  ]
  const seg2 = [
    mid,
    { latitude: destination.latitude, longitude: destination.longitude },
  ]
  return {
    mode,
    distanceMeters: Math.round(dist),
    durationSeconds: Math.max(60, Math.round(dist / speed)),
    points: [...seg1, seg2[1]],
    summary: '演示路线（未配置 Web Key）',
    steps: [
      {
        kind,
        title: `${label}至中途`,
        detail: '配置高德 Web Key 后可显示真实分步',
        distanceMeters: Math.round(dist / 2),
        points: seg1,
        color: stepColorAt(0),
      },
      {
        kind,
        title: `${label}约 ${formatStepDistance(dist / 2)} 至终点`,
        distanceMeters: Math.round(dist / 2),
        points: seg2,
        color: stepColorAt(1),
      },
    ],
  }
}

async function requestJson(url: string): Promise<Record<string, unknown>> {
  let res: Taro.request.SuccessCallbackResult<unknown>
  try {
    res = await Taro.request({
      url,
      method: 'GET',
      timeout: 20000,
      dataType: 'json',
    })
  } catch (err) {
    throw new Error(explainRequestError(extractErrorMessage(err)))
  }

  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`请求异常(HTTP ${res.statusCode})`)
  }

  let data = res.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      throw new Error(`高德返回非 JSON：${data.slice(0, 80)}`)
    }
  }
  if (!data || typeof data !== 'object') {
    throw new Error('未拿到高德返回数据，请稍后重试')
  }
  return data as Record<string, unknown>
}

async function reverseCity(location: UserLocation, key: string): Promise<string> {
  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
    `&location=${formatLocation(location)}&extensions=base`
  const data = await requestJson(url)
  if (String(data.status ?? '') !== '1') {
    throw new Error(`逆地理失败：${asText(data.info) || '未知错误'}`)
  }
  const regeocode = data.regeocode as
    | { addressComponent?: { city?: unknown; province?: unknown; adcode?: unknown } }
    | undefined
  const comp = regeocode?.addressComponent
  const city = asText(comp?.city)
  const province = asText(comp?.province)
  const adcode = asText(comp?.adcode)
  // 直辖市 city 可能为空数组，用 province / adcode 兜底
  return city || province || adcode.slice(0, 4) || '全国'
}

function parseOneWalkingOrRidingPath(
  mode: NavMode,
  path: {
    distance?: unknown
    duration?: unknown
    steps?: Array<{
      polyline?: unknown
      instruction?: unknown
      road?: unknown
      distance?: unknown
      duration?: unknown
    }>
  },
): NavRoute | null {
  const points: NavRoutePoint[] = []
  const steps: NavRouteStep[] = []
  const kind = mode === 'walking' ? 'walk' : 'ride'

  for (const step of path.steps || []) {
    const segPts = collectPolylinePoints(step.polyline)
    appendPolyline(points, step.polyline)
    const title = asText(step.instruction) || asText(step.road)
    if (!title) continue
    const distanceMeters = Math.round(toNumber(step.distance)) || undefined
    const durationSeconds = Math.round(toNumber(step.duration)) || undefined
    steps.push({
      kind,
      title,
      distanceMeters,
      durationSeconds,
      points: segPts.length >= 2 ? segPts : undefined,
      color: stepColorAt(steps.length),
    })
  }

  if (points.length < 2) return null
  return {
    mode,
    distanceMeters: Math.round(toNumber(path.distance)),
    durationSeconds: Math.round(toNumber(path.duration)),
    points,
    steps,
  }
}

const MAX_ROUTE_SCHEMES = 3

function parseWalkingOrRidingPaths(
  mode: NavMode,
  paths: unknown,
): NavRoute[] {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const list: NavRoute[] = []
  for (const raw of paths.slice(0, MAX_ROUTE_SCHEMES)) {
    const parsed = parseOneWalkingOrRidingPath(
      mode,
      raw as {
        distance?: unknown
        duration?: unknown
        steps?: Array<{
          polyline?: unknown
          instruction?: unknown
          road?: unknown
          distance?: unknown
          duration?: unknown
        }>
      },
    )
    if (parsed) list.push(parsed)
  }
  return list
}

function parseOneTransit(
  best: {
    distance?: unknown
    duration?: unknown
    segments?: Array<Record<string, unknown>>
  },
): NavRoute | null {
  const points: NavRoutePoint[] = []
  const lineNames: string[] = []
  const steps: NavRouteStep[] = []

  for (const seg of best.segments || []) {
    const walking = seg.walking as
      | {
          distance?: unknown
          duration?: unknown
          steps?: Array<{ polyline?: unknown; instruction?: unknown }>
        }
      | undefined
    const walkDist = Math.round(toNumber(walking?.distance))
    const walkDur = Math.round(toNumber(walking?.duration))
    const walkRaws = (walking?.steps || []).map((s) => s.polyline)
    const walkPts = collectMergedPolylinePoints(walkRaws)
    for (const raw of walkRaws) appendPolyline(points, raw)

    if (walkDist > 0) {
      const entrance = seg.entrance as { name?: unknown } | undefined
      const exit = seg.exit as { name?: unknown } | undefined
      const gate = asText(entrance?.name) || asText(exit?.name)
      steps.push({
        kind: 'walk',
        title: `步行约 ${formatStepDistance(walkDist)}`,
        detail: gate ? `经 ${gate}` : undefined,
        distanceMeters: walkDist,
        durationSeconds: walkDur || undefined,
        points: walkPts.length >= 2 ? walkPts : undefined,
        color: stepColorAt(steps.length),
      })
    }

    const bus = seg.bus as
      | {
          buslines?: Array<{
            polyline?: unknown
            name?: unknown
            type?: unknown
            distance?: unknown
            duration?: unknown
            via_num?: unknown
            via_stops?: unknown
            departure_stop?: unknown
            arrival_stop?: unknown
          }>
        }
      | undefined

    const line = bus?.buslines?.[0]
    if (line) {
      const busPts = collectPolylinePoints(line.polyline)
      appendPolyline(points, line.polyline)
      const rawName = asText(line.name)
      const shortName = rawName.split('(')[0] || rawName
      if (shortName) lineNames.push(shortName)
      const type = asText(line.type)
      const metro = isMetroLine(type, shortName)
      const dep = asStopName(line.departure_stop)
      const arr = asStopName(line.arrival_stop)
      const viaNum =
        Math.round(toNumber(line.via_num)) ||
        (Array.isArray(line.via_stops) ? line.via_stops.length : 0)
      const detailParts: string[] = []
      if (dep && arr) detailParts.push(`${dep}上车 → ${arr}下车`)
      else if (dep) detailParts.push(`${dep}上车`)
      else if (arr) detailParts.push(`${arr}下车`)
      if (viaNum > 0) detailParts.push(`途经 ${viaNum} 站`)

      steps.push({
        kind: metro ? 'metro' : 'bus',
        title: shortName ? `乘坐${shortName}` : metro ? '乘坐地铁' : '乘坐公交',
        detail: detailParts.length > 0 ? detailParts.join('，') : undefined,
        distanceMeters: Math.round(toNumber(line.distance)) || undefined,
        durationSeconds: Math.round(toNumber(line.duration)) || undefined,
        points: busPts.length >= 2 ? busPts : undefined,
        color: stepColorAt(steps.length),
      })
    }

    const railway = seg.railway as
      | {
          polyline?: unknown
          name?: unknown
          distance?: unknown
          time?: unknown
          departure_stop?: unknown
          arrival_stop?: unknown
        }
      | undefined
    if (railway && (asText(railway.name) || railway.polyline)) {
      const railPts = collectPolylinePoints(railway.polyline)
      appendPolyline(points, railway.polyline)
      const name = asText(railway.name)
      if (name) lineNames.push(name)
      const dep = asStopName(railway.departure_stop)
      const arr = asStopName(railway.arrival_stop)
      steps.push({
        kind: 'railway',
        title: name ? `乘坐${name}` : '乘坐火车',
        detail:
          dep && arr ? `${dep} → ${arr}` : dep || arr || undefined,
        distanceMeters: Math.round(toNumber(railway.distance)) || undefined,
        durationSeconds: Math.round(toNumber(railway.time)) || undefined,
        points: railPts.length >= 2 ? railPts : undefined,
        color: stepColorAt(steps.length),
      })
    }
  }

  if (points.length < 2) return null
  return {
    mode: 'transit',
    distanceMeters: Math.round(toNumber(best.distance)),
    durationSeconds: Math.round(toNumber(best.duration)),
    points,
    summary: lineNames.length > 0 ? lineNames.join(' → ') : undefined,
    steps,
  }
}

function parseTransitSchemes(route: Record<string, unknown>): NavRoute[] {
  const transits = route.transits
  if (!Array.isArray(transits) || transits.length === 0) return []
  const list: NavRoute[] = []
  for (const raw of transits.slice(0, MAX_ROUTE_SCHEMES)) {
    const parsed = parseOneTransit(
      raw as {
        distance?: unknown
        duration?: unknown
        segments?: Array<Record<string, unknown>>
      },
    )
    if (parsed) list.push(parsed)
  }
  return list
}

function mockRoutes(
  mode: NavMode,
  origin: UserLocation,
  destination: UserLocation,
): NavRoute[] {
  const base = mockRoute(mode, origin, destination)
  const alt: NavRoute = {
    ...base,
    distanceMeters: Math.round(base.distanceMeters * 1.12),
    durationSeconds: Math.round(base.durationSeconds * 1.18),
    summary: base.summary ? `${base.summary} · 备选` : '演示备选方案',
    steps: base.steps.map((s, i) => ({
      ...s,
      title: s.title.includes('备选') ? s.title : `${s.title}（备选）`,
      color: stepColorAt(i),
      points: s.points ? s.points.map((p) => ({ ...p })) : undefined,
    })),
  }
  return [base, alt]
}

/**
 * 规划多套路线方案（最多 3 套）。
 * 公交需城市参数，内部会逆地理起点城市。
 */
export async function planRoutes(
  mode: NavMode,
  origin: UserLocation,
  destination: UserLocation,
): Promise<NavRoute[]> {
  const key = AMAP_CONFIG.webServiceKey
  if (isPlaceholderKey(key)) {
    return mockRoutes(mode, origin, destination)
  }

  const o = formatLocation(origin)
  const d = formatLocation(destination)

  if (mode === 'walking') {
    const url =
      `https://restapi.amap.com/v3/direction/walking?key=${encodeURIComponent(key)}` +
      `&origin=${o}&destination=${d}`
    const data = await requestJson(url)
    if (String(data.status ?? '') !== '1') {
      throw new Error(`步行路线失败：${asText(data.info) || '未知错误'}`)
    }
    const route = data.route as { paths?: unknown } | undefined
    const list = parseWalkingOrRidingPaths('walking', route?.paths)
    if (list.length === 0) throw new Error('未找到可行步行路线')
    return list
  }

  if (mode === 'riding') {
    const url =
      `https://restapi.amap.com/v4/direction/bicycling?key=${encodeURIComponent(key)}` +
      `&origin=${o}&destination=${d}`
    const data = await requestJson(url)
    if (Number(data.errcode) !== 0 && String(data.status ?? '') !== '1') {
      throw new Error(
        `骑行路线失败：${asText(data.errdetail) || asText(data.info) || '未知错误'}`,
      )
    }
    const payload = (data.data || data.route) as { paths?: unknown } | undefined
    const list = parseWalkingOrRidingPaths('riding', payload?.paths)
    if (list.length === 0) throw new Error('未找到可行骑行路线')
    return list
  }

  const city = await reverseCity(origin, key)
  const url =
    `https://restapi.amap.com/v3/direction/transit/integrated?key=${encodeURIComponent(key)}` +
    `&origin=${o}&destination=${d}` +
    `&city=${encodeURIComponent(city)}&strategy=0&nightflag=0&extensions=all`
  const data = await requestJson(url)
  if (String(data.status ?? '') !== '1') {
    throw new Error(`公交路线失败：${asText(data.info) || '未知错误'}`)
  }
  const route = data.route as Record<string, unknown> | undefined
  if (!route) throw new Error('未找到可行公交路线')
  const list = parseTransitSchemes(route)
  if (list.length === 0) throw new Error('未找到可行公交路线')
  return list
}

/** 规划单条推荐路线（取第一套方案） */
export async function planRoute(
  mode: NavMode,
  origin: UserLocation,
  destination: UserLocation,
): Promise<NavRoute> {
  const list = await planRoutes(mode, origin, destination)
  return list[0]
}

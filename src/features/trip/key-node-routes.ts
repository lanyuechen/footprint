import type { NavMode, TripStop } from '../../types'
import { planRoute } from '../../services/amap'
import { formatDistance } from '../../utils/datetime'
import { MARKER_ID_ROUTE_DIST } from '../../components/sheet-map'
import { NUMBERED_DOT_FALLBACK } from './numbered-dot-markers'

export type KeyNodeRouteSegment = {
  fromStopId: string
  toStopId: string
  mode: NavMode
  distanceMeters: number
  points: Array<{ latitude: number; longitude: number }>
}

const MODE_LINE_COLOR: Record<NavMode, string> = {
  walking: '#1a5f4a',
  riding: '#0ea5e9',
  transit: '#f97316',
}

const MODE_LABEL: Record<NavMode, string> = {
  walking: '步行',
  riding: '骑行',
  transit: '公交',
}

export function keyNodeRouteLineColor(mode: NavMode): string {
  return MODE_LINE_COLOR[mode] || MODE_LINE_COLOR.walking
}

type KeyNodeRouteJob = {
  fromStopId: string
  toStopId: string
  mode: NavMode
  origin: { latitude: number; longitude: number }
  destination: { latitude: number; longitude: number }
}

/** 高德路径规划并发上限为 3 */
const ROUTE_CONCURRENCY = 3
const ROUTE_RETRY_MAX = 3
const ROUTE_RETRY_BASE_MS = 600

/** 同起终点同方式缓存，避免切日/重渲染反复打接口 */
const routeSegmentCache = new Map<string, KeyNodeRouteSegment>()

function sleep(ms: number, signal?: { cancelled: boolean }) {
  return new Promise<void>((resolve) => {
    if (signal?.cancelled || ms <= 0) {
      resolve()
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      if (signal?.cancelled || Date.now() - started >= ms) {
        clearInterval(timer)
        resolve()
      }
    }, 40)
  })
}

function coordKey(lat: number, lng: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

function jobCacheKey(job: KeyNodeRouteJob) {
  return [
    job.mode,
    coordKey(job.origin.latitude, job.origin.longitude),
    coordKey(job.destination.latitude, job.destination.longitude),
  ].join('|')
}

function isRateLimitError(err: unknown): boolean {
  const msg = String(
    err && typeof err === 'object' && 'message' in err
      ? (err as { message: unknown }).message
      : err,
  ).toUpperCase()
  return (
    msg.includes('CUQPS') ||
    msg.includes('QPS') ||
    msg.includes('DAILY_QUERY') ||
    msg.includes('OVER_LIMIT') ||
    msg.includes('ACCESS_TOO_FREQUENT') ||
    msg.includes('USER_DAILY') ||
    msg.includes('TOO FREQUENT')
  )
}

function segmentFromRoute(
  job: KeyNodeRouteJob,
  route: { distanceMeters?: number; points: KeyNodeRouteSegment['points'] },
): KeyNodeRouteSegment | null {
  const points =
    route.points.length >= 2
      ? route.points
      : [
          {
            latitude: job.origin.latitude,
            longitude: job.origin.longitude,
          },
          {
            latitude: job.destination.latitude,
            longitude: job.destination.longitude,
          },
        ]
  if (points.length < 2) return null
  return {
    fromStopId: job.fromStopId,
    toStopId: job.toStopId,
    mode: job.mode,
    distanceMeters: Math.max(0, Math.round(route.distanceMeters || 0)),
    points,
  }
}

/** 最多 concurrency 路同时执行，结果按原顺序返回 */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: { cancelled: boolean },
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (true) {
        if (signal?.cancelled) return
        const i = next++
        if (i >= items.length) return
        results[i] = await worker(items[i]!, i)
      }
    },
  )
  await Promise.all(runners)
  return results
}

/** 按当日行程顺序，取关键节点并生成相邻段（终点节点的前往方式） */
export function buildKeyNodeRouteJobs(
  dayStops: Array<
    Pick<TripStop, 'id' | 'isKeyNode' | 'travelMode'> & {
      place: { latitude: number; longitude: number }
    }
  >,
): KeyNodeRouteJob[] {
  const keyNodes = dayStops.filter((s) => s.isKeyNode)
  if (keyNodes.length < 2) return []
  const jobs: KeyNodeRouteJob[] = []
  for (let i = 1; i < keyNodes.length; i++) {
    const from = keyNodes[i - 1]!
    const to = keyNodes[i]!
    const mode: NavMode =
      to.travelMode === 'riding' || to.travelMode === 'transit'
        ? to.travelMode
        : 'walking'
    jobs.push({
      fromStopId: from.id,
      toStopId: to.id,
      mode,
      origin: {
        latitude: from.place.latitude,
        longitude: from.place.longitude,
      },
      destination: {
        latitude: to.place.latitude,
        longitude: to.place.longitude,
      },
    })
  }
  return jobs
}

async function planOneJob(
  job: KeyNodeRouteJob,
  signal?: { cancelled: boolean },
): Promise<KeyNodeRouteSegment | null> {
  const cacheKey = jobCacheKey(job)
  const cached = routeSegmentCache.get(cacheKey)
  if (cached) {
    return {
      ...cached,
      fromStopId: job.fromStopId,
      toStopId: job.toStopId,
    }
  }

  for (let attempt = 0; attempt <= ROUTE_RETRY_MAX; attempt++) {
    if (signal?.cancelled) return null
    try {
      const route = await planRoute(job.mode, job.origin, job.destination)
      if (signal?.cancelled) return null
      const seg = segmentFromRoute(job, route)
      if (seg) routeSegmentCache.set(cacheKey, seg)
      return seg
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= ROUTE_RETRY_MAX) return null
      await sleep(ROUTE_RETRY_BASE_MS * 2 ** attempt, signal)
    }
  }
  return null
}

/** 规划关键节点有向路径段；最多 3 并发 + 缓存，失败段跳过 */
export async function planKeyNodeRouteSegments(
  dayStops: Array<
    Pick<TripStop, 'id' | 'isKeyNode' | 'travelMode'> & {
      place: { latitude: number; longitude: number }
    }
  >,
  signal?: { cancelled: boolean },
): Promise<KeyNodeRouteSegment[]> {
  const jobs = buildKeyNodeRouteJobs(dayStops)
  if (jobs.length === 0) return []
  const segments = await mapPool(
    jobs,
    ROUTE_CONCURRENCY,
    (job) => planOneJob(job, signal),
    signal,
  )
  if (signal?.cancelled) return []
  return segments.filter((seg): seg is KeyNodeRouteSegment => seg != null)
}

export function keyNodeSegmentsToPolylines(segments: KeyNodeRouteSegment[]) {
  return segments.map((seg) => ({
    points: seg.points,
    color: keyNodeRouteLineColor(seg.mode),
    width: 6,
    dottedLine: false,
    arrowLine: true,
  }))
}

function segmentMidpoint(
  points: Array<{ latitude: number; longitude: number }>,
) {
  const mid = Math.floor(points.length / 2)
  const p = points[mid] || points[0]
  return { latitude: p.latitude, longitude: p.longitude }
}

/** 路径中点距离气泡（微小锚点 + ALWAYS callout） */
export function keyNodeSegmentsToDistanceMarkers(
  segments: KeyNodeRouteSegment[],
) {
  return segments
    .map((seg, index) => {
      const dist = formatDistance(seg.distanceMeters)
      if (!dist || seg.points.length < 2) return null
      const mid = segmentMidpoint(seg.points)
      const color = keyNodeRouteLineColor(seg.mode)
      const modeLabel = MODE_LABEL[seg.mode] || MODE_LABEL.walking
      return {
        id: MARKER_ID_ROUTE_DIST + index,
        latitude: mid.latitude,
        longitude: mid.longitude,
        width: 1,
        height: 1,
        iconPath: NUMBERED_DOT_FALLBACK,
        anchor: { x: 0.5, y: 0.5 },
        // 高于行程点（10/20），保证距离 callout 不被遮挡
        zIndex: 100,
        callout: {
          content: `${modeLabel} ${dist}`,
          color,
          fontSize: 11,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#e8ecef',
          bgColor: '#ffffff',
          padding: 6,
          display: 'ALWAYS' as const,
          textAlign: 'center' as const,
        },
      }
    })
    .filter((m): m is NonNullable<typeof m> => m != null)
}

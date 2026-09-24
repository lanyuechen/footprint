import type { NavMode, TripStop } from '../../types'
import {
  buildFlightArcPoints,
  buildStraightLinePoints,
  distanceMeters,
  planRoute,
} from '../../services/amap'
import { formatDistance } from '../../utils/datetime'
import { MARKER_ID_ROUTE_DIST } from '../../components/sheet-map'
import { NUMBERED_DOT_FALLBACK } from './numbered-dot-markers'
import { isDashNavMode, navModeMeta, normalizeNavMode } from './nav-mode'

export type KeyNodeRouteSegment = {
  fromStopId: string
  toStopId: string
  mode: NavMode
  distanceMeters: number
  /** 规划耗时（秒）；示意段可能为估算值 */
  durationSeconds?: number
  points: Array<{ latitude: number; longitude: number }>
}

export function keyNodeRouteLineColor(mode: NavMode): string {
  return navModeMeta(mode).color
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
  route: {
    distanceMeters?: number
    durationSeconds?: number
    points: KeyNodeRouteSegment['points']
  },
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
  const durationSeconds =
    route.durationSeconds != null && route.durationSeconds > 0
      ? Math.round(route.durationSeconds)
      : undefined
  return {
    fromStopId: job.fromStopId,
    toStopId: job.toStopId,
    mode: job.mode,
    distanceMeters: Math.max(0, Math.round(route.distanceMeters || 0)),
    ...(durationSeconds ? { durationSeconds } : {}),
    points,
  }
}

function buildFlightSegment(job: KeyNodeRouteJob): KeyNodeRouteSegment {
  const dist = Math.round(distanceMeters(job.origin, job.destination))
  const points = buildFlightArcPoints(job.origin, job.destination)
  // 粗估巡航 ~800km/h
  const durationSeconds = Math.max(600, Math.round((dist / 1000 / 800) * 3600))
  return {
    fromStopId: job.fromStopId,
    toStopId: job.toStopId,
    mode: 'flight',
    distanceMeters: dist,
    durationSeconds,
    points,
  }
}

function buildRailSegment(job: KeyNodeRouteJob): KeyNodeRouteSegment {
  const dist = Math.round(distanceMeters(job.origin, job.destination))
  const points = buildStraightLinePoints(job.origin, job.destination)
  // 粗估高铁 ~250km/h
  const durationSeconds = Math.max(600, Math.round((dist / 1000 / 250) * 3600))
  return {
    fromStopId: job.fromStopId,
    toStopId: job.toStopId,
    mode: 'rail',
    distanceMeters: dist,
    durationSeconds,
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

/** 按当日行程顺序生成关键节点路径段；无前置关键点时用当日第一点作起点 */
export function buildKeyNodeRouteJobs(
  dayStops: Array<
    Pick<TripStop, 'id' | 'isKeyNode' | 'travelMode'> & {
      place: { latitude: number; longitude: number }
    }
  >,
): KeyNodeRouteJob[] {
  if (dayStops.length === 0) return []
  const first = dayStops[0]!
  const keyNodes = dayStops.filter((s) => s.isKeyNode)
  if (keyNodes.length === 0) return []

  const jobs: KeyNodeRouteJob[] = []
  let prevKey:
    | (typeof dayStops)[number]
    | null = null

  for (const to of keyNodes) {
    const from = prevKey ?? first
    prevKey = to
    // 当日第一点本身就是关键点时，没有「前往它」的前一段
    if (from.id === to.id) continue
    const mode = normalizeNavMode(to.travelMode) || 'walking'
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

  if (job.mode === 'flight') {
    const seg = buildFlightSegment(job)
    routeSegmentCache.set(cacheKey, seg)
    return seg
  }

  if (job.mode === 'rail') {
    const seg = buildRailSegment(job)
    routeSegmentCache.set(cacheKey, seg)
    return seg
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
  return segments.map((seg) => {
    const dash = isDashNavMode(seg.mode)
    return {
      points: seg.points,
      color: keyNodeRouteLineColor(seg.mode),
      width: dash ? 5 : 6,
      dottedLine: dash,
      arrowLine: !dash,
    }
  })
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
      const meta = navModeMeta(seg.mode)
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
          content: `${meta.label} ${dist}`,
          color: meta.color,
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

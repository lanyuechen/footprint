import Taro from '@tarojs/taro'

const PRELOAD_COUNT = 20
const CANVAS_SIZE = 128
const DEFAULT_FILL = '#1a5f4a'
const DEFAULT_STROKE = '#ffffff'

export type DotMarkerStyle = {
  /** 圆填充色 */
  fill?: string
  /** 圆描边色 */
  stroke?: string
  /** 文字色，默认与描边同色 */
  textColor?: string
}

type ResolvedDotStyle = {
  fill: string
  stroke: string
  textColor: string
}

/** 编号 → 本地文件路径（内存缓存）；key 含样式 */
const pathCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

/** 文案圆点（起/终等）缓存 */
const labelPathCache = new Map<string, string>()
const labelInflight = new Map<string, Promise<string>>()

let preloadPromise: Promise<void> | null = null

function userDataPath(): string {
  const env = (Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env
  return env?.USER_DATA_PATH || ''
}

function resolveStyle(style?: DotMarkerStyle): ResolvedDotStyle {
  const fill = style?.fill?.trim() || DEFAULT_FILL
  const stroke = style?.stroke?.trim() || DEFAULT_STROKE
  const textColor = style?.textColor?.trim() || stroke
  return { fill, stroke, textColor }
}

function styleToken(style: ResolvedDotStyle): string {
  const isDefault =
    style.fill === DEFAULT_FILL &&
    style.stroke === DEFAULT_STROKE &&
    style.textColor === DEFAULT_STROKE
  if (isDefault) return ''
  return `-${[style.fill, style.stroke, style.textColor]
    .join('_')
    .replace(/#/g, '')}`
}

function numberedCacheKey(n: number, style: ResolvedDotStyle): string {
  return `${n}${styleToken(style)}`
}

function labelCacheKey(label: string, style: ResolvedDotStyle): string {
  return `${label}${styleToken(style)}`
}

function filePathForNumber(n: number, style: ResolvedDotStyle): string {
  const base = userDataPath()
  if (!base) return ''
  return `${base}/trip-marker-dot-${n}${styleToken(style)}.png`
}

function filePathForLabel(label: string, style: ResolvedDotStyle): string {
  const base = userDataPath()
  if (!base) return ''
  const name =
    label === '起' ? 'start' : label === '终' ? 'end' : `l${label.length}`
  return `${base}/trip-marker-dot-${name}${styleToken(style)}.png`
}

function tryExistingPath(
  cache: Map<string, string>,
  key: string,
  filePath: string,
): string | null {
  const cached = cache.get(key)
  if (cached) return cached
  if (!filePath) return null
  try {
    Taro.getFileSystemManager().accessSync(filePath)
    cache.set(key, filePath)
    return filePath
  } catch {
    return null
  }
}

function drawLabeledDot(
  ctx: CanvasRenderingContext2D,
  size: number,
  label: string,
  style: ResolvedDotStyle,
) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 6
  ctx.clearRect(0, 0, size, size)

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = style.fill
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = style.stroke
  ctx.stroke()

  const text = label
  const fontSize = text.length >= 3 ? 42 : text.length === 2 ? 48 : 56
  ctx.fillStyle = style.textColor
  ctx.font = `600 ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy + 2)
}

async function canvasToPngFile(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  dest: string,
  cacheSet: (path: string) => void,
): Promise<string> {
  const size = CANVAS_SIZE
  const canvas = Taro.createOffscreenCanvas({
    type: '2d',
    width: size,
    height: size,
  })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('无法创建画布')

  draw(ctx, size)

  const anyCanvas = canvas as unknown as {
    toDataURL?: (type?: string) => string
  }

  if (dest && typeof anyCanvas.toDataURL === 'function') {
    const base64 = anyCanvas.toDataURL('image/png')
    const data = base64.replace(/^data:image\/\w+;base64,/, '')
    Taro.getFileSystemManager().writeFileSync(dest, data, 'base64')
    cacheSet(dest)
    return dest
  }

  const res = await Taro.canvasToTempFilePath({
    canvas: canvas as never,
    width: size,
    height: size,
    destWidth: size,
    destHeight: size,
    fileType: 'png',
  })
  const temp = res.tempFilePath
  if (dest) {
    try {
      Taro.getFileSystemManager().copyFileSync(temp, dest)
      cacheSet(dest)
      return dest
    } catch {
      // fall through to temp
    }
  }
  cacheSet(temp)
  return temp
}

async function renderNumberedToFile(
  n: number,
  style: ResolvedDotStyle,
): Promise<string> {
  const key = numberedCacheKey(n, style)
  const dest = filePathForNumber(n, style)
  const existing = tryExistingPath(pathCache, key, dest)
  if (existing) return existing

  return canvasToPngFile(
    (ctx, size) => drawLabeledDot(ctx, size, String(n), style),
    dest,
    (path) => pathCache.set(key, path),
  )
}

async function renderLabelToFile(
  label: string,
  style: ResolvedDotStyle,
): Promise<string> {
  const key = labelCacheKey(label, style)
  const dest = filePathForLabel(label, style)
  const existing = tryExistingPath(labelPathCache, key, dest)
  if (existing) return existing

  return canvasToPngFile(
    (ctx, size) => drawLabeledDot(ctx, size, label, style),
    dest,
    (path) => labelPathCache.set(key, path),
  )
}

/** 确保编号 n 的圆形 marker 已生成并返回本地路径（纯 canvas 画圆，可指定颜色） */
export function ensureNumberedDotMarker(
  n: number,
  style?: DotMarkerStyle,
): Promise<string> {
  if (!Number.isFinite(n) || n < 1) {
    return Promise.reject(new Error('invalid marker number'))
  }
  const num = Math.floor(n)
  const resolved = resolveStyle(style)
  const key = numberedCacheKey(num, resolved)
  const hit = tryExistingPath(pathCache, key, filePathForNumber(num, resolved))
  if (hit) return Promise.resolve(hit)

  let job = inflight.get(key)
  if (!job) {
    job = renderNumberedToFile(num, resolved)
      .catch((err) => {
        pathCache.delete(key)
        throw err
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, job)
  }
  return job
}

/** 圆点 + 文案（如「起」「终」），纯 canvas 画圆，可指定颜色 */
export function ensureLabeledDotMarker(
  label: string,
  style?: DotMarkerStyle,
): Promise<string> {
  const text = label.trim()
  if (!text) return Promise.reject(new Error('invalid marker label'))

  const resolved = resolveStyle(style)
  const key = labelCacheKey(text, resolved)
  const hit = tryExistingPath(
    labelPathCache,
    key,
    filePathForLabel(text, resolved),
  )
  if (hit) return Promise.resolve(hit)

  let job = labelInflight.get(key)
  if (!job) {
    job = renderLabelToFile(text, resolved)
      .catch((err) => {
        labelPathCache.delete(key)
        throw err
      })
      .finally(() => {
        labelInflight.delete(key)
      })
    labelInflight.set(key, job)
  }
  return job
}

/** 确保 [from, to] 闭区间编号都已生成 */
export async function ensureNumberedDotMarkersRange(
  from: number,
  to: number,
  style?: DotMarkerStyle,
): Promise<void> {
  const start = Math.max(1, Math.floor(from))
  const end = Math.max(start, Math.floor(to))
  const tasks: Promise<unknown>[] = []
  for (let i = start; i <= end; i++) {
    tasks.push(ensureNumberedDotMarker(i, style).catch(() => null))
  }
  await Promise.all(tasks)
}

/**
 * 进入计划时预生成 1～20。
 * 可重复调用，只会跑一轮。
 */
export function preloadNumberedDotMarkers(
  count = PRELOAD_COUNT,
): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = ensureNumberedDotMarkersRange(1, count).finally(() => {
      // 允许失败后再次触发预加载
      if (pathCache.size < count) preloadPromise = null
    })
  }
  return preloadPromise
}

/** 同步读取已缓存路径；未生成返回空 */
export function getNumberedDotMarkerPath(
  n: number,
  style?: DotMarkerStyle,
): string {
  const resolved = resolveStyle(style)
  const key = numberedCacheKey(Math.floor(n), resolved)
  return (
    tryExistingPath(pathCache, key, filePathForNumber(Math.floor(n), resolved)) ||
    ''
  )
}

/** 同步读取文案圆点路径；未生成返回空 */
export function getLabeledDotMarkerPath(
  label: string,
  style?: DotMarkerStyle,
): string {
  const text = label.trim()
  const resolved = resolveStyle(style)
  const key = labelCacheKey(text, resolved)
  return (
    tryExistingPath(labelPathCache, key, filePathForLabel(text, resolved)) || ''
  )
}

/** 当前内存中已有的编号路径快照（触发 UI 刷新用；仅默认配色） */
export function snapshotNumberedDotMarkerPaths(): Record<number, string> {
  const out: Record<number, string> = {}
  pathCache.forEach((path, key) => {
    if (/^\d+$/.test(key)) out[Number(key)] = path
  })
  return out
}

export const NUMBERED_DOT_PRELOAD_COUNT = PRELOAD_COUNT
export const NUMBERED_DOT_DISPLAY_SIZE = 28
export const NUMBERED_DOT_SELECTED_SIZE = 34
/** 仅作未生成完成时的临时占位，生成过程不读取该图 */
export const NUMBERED_DOT_FALLBACK = '/assets/markers/dot.png'
export const DOT_MARKER_DEFAULT_FILL = DEFAULT_FILL
export const DOT_MARKER_DEFAULT_STROKE = DEFAULT_STROKE

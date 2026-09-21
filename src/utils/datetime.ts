/** 将 ISO 时间格式化为 YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** 按本地年份分组的 key */
export function yearKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || 'unknown'
  return String(d.getFullYear())
}

/** 时间轴年份节点：2026年 */
export function formatYearLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}年`
}

/** 时间轴日期节点：9月16日 */
export function formatMonthDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 时间轴日期节点：2026年3月7日 */
export function formatDayLabel(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 同一天内的时刻：HH:mm */
export function formatClock(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 收藏地点起止日的历时天数（含首尾当天）；没有有效时间则为 0 */
export function spanDays(isos: string[]): number {
  let start: number | null = null
  let end: number | null = null
  for (const iso of isos) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) continue
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    if (start == null || day < start) start = day
    if (end == null || day > end) end = day
  }
  if (start == null || end == null) return 0
  return Math.round((end - start) / 86400000) + 1
}

/** 计划摘要：m 个地点 · n 天 */
export function formatPlanSummary(placeCount: number, days: number): string {
  return `${placeCount} 个地点 · ${days} 天`
}

/** 按本地日期分组的 key：YYYY-M-D */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || 'unknown'
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** picker 用：YYYY-MM-DD */
export function toDatePart(iso: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** picker 用：HH:mm */
export function toTimePart(iso: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 由日期 + 时间拼成本地时间对应的 ISO */
export function combineDateTime(datePart: string, timePart: string): string {
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

function parseDatePartLocal(datePart: string): Date | null {
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  const day = new Date(y, m - 1, d)
  if (Number.isNaN(day.getTime())) return null
  return day
}

/** 计划 startDate + dayIndex → YYYY-MM-DD */
export function datePartOfDay(startDate: string, dayIndex: number): string {
  const day = parseDatePartLocal(startDate)
  if (!day) return startDate
  day.setDate(day.getDate() + Math.max(0, Math.floor(dayIndex)))
  return toDatePart(day.toISOString())
}

/** YYYY-MM-DD 相对 startDate 的天数偏移（≥0）；无法解析时返回 0 */
export function dayIndexOfDate(startDate: string, datePart: string): number {
  const start = parseDatePartLocal(startDate)
  const day = parseDatePartLocal(datePart)
  if (!start || !day) return 0
  const offset = Math.round((day.getTime() - start.getTime()) / 86400000)
  return offset < 0 ? 0 : offset
}

/** 归一备注：优先纯文本，否则从 HTML 抽文本 */
export function normalizeNoteText(
  note?: unknown,
  noteText?: unknown,
  noteHtml?: unknown,
): string | undefined {
  if (typeof note === 'string' && note.trim()) return note.trim()
  if (typeof noteText === 'string' && noteText.trim()) return noteText.trim()
  if (typeof noteHtml === 'string' && noteHtml.trim()) {
    const plain = noteHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return plain || undefined
  }
  return undefined
}

/** 校验 HH:mm；非法则返回 undefined */
export function normalizeTimePart(time?: unknown): string | undefined {
  if (typeof time !== 'string') return undefined
  const t = time.trim()
  if (!/^\d{1,2}:\d{2}$/.test(t)) return undefined
  const [hh, mm] = t.split(':').map(Number)
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** 距离展示：米 / 公里 */
export function formatDistance(meters?: number): string {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return ''
  if (meters < 1000) return `${Math.round(meters)}m`
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`
}

/** 时长展示：分钟 / 小时 */
export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const mins = Math.max(1, Math.round(seconds / 60))
  if (mins < 60) return `${mins}分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}小时${m}分` : `${h}小时`
}

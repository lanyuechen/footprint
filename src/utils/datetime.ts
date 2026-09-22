/** picker 用：YYYY-MM-DD */
export function toDatePart(iso: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

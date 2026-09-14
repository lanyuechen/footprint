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

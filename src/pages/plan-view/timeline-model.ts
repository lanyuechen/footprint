import type { TargetPoint } from '../../types'

export type TimelineDay = {
  key: string
  label: string
  weekday: string
  points: TargetPoint[]
}

export type TimelineYear = {
  key: string
  label: string
  days: TimelineDay[]
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function byExpectedAt(a: TargetPoint, b: TargetPoint) {
  return new Date(a.expectedAt).getTime() - new Date(b.expectedAt).getTime()
}

function localDayStart(iso: string): Date | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function localDayKey(day: Date) {
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`
}

/** 按预期时间排序后按年、日分组，不补中间空日期 */
export function groupPointsByYear(points: TargetPoint[]): TimelineYear[] {
  const years: TimelineYear[] = []
  for (const point of [...points].sort(byExpectedAt)) {
    const day = localDayStart(point.expectedAt)
    if (!day) continue
    const yKey = String(day.getFullYear())
    let year = years[years.length - 1]
    if (!year || year.key !== yKey) {
      year = { key: yKey, label: `${day.getFullYear()}年`, days: [] }
      years.push(year)
    }
    const key = localDayKey(day)
    let group = year.days[year.days.length - 1]
    if (!group || group.key !== key) {
      group = {
        key,
        label: `${day.getMonth() + 1}月${day.getDate()}日`,
        weekday: WEEKDAYS[day.getDay()],
        points: [],
      }
      year.days.push(group)
    }
    group.points.push(point)
  }
  return years
}

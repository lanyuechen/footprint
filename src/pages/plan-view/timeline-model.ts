import type { CollectedPlace, TravelPlan, TripStop } from '../../types'
import { datePartOfDay } from '../../utils/datetime'

export type TimelineDay = {
  key: string
  dayIndex: number
  datePart: string
  label: string
  weekday: string
  stops: Array<TripStop & { place: CollectedPlace['place']; collected: CollectedPlace }>
}

export type TimelineYear = {
  key: string
  label: string
  days: TimelineDay[]
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function parseDatePart(datePart: string): Date | null {
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  const day = new Date(y, m - 1, d)
  if (Number.isNaN(day.getTime())) return null
  return day
}

/**
 * 以计划 startDate 为基准展开 dayCount 天，按 stop.dayIndex 挂到对应日。
 * 日内顺序沿用传入 stops 的顺序（由 plan.stopIds / 添加与拖拽决定），不按时刻排序。
 * 收藏地点通过 placeId 解析；解析失败的 stop 跳过。
 */
export function buildTimelineYears(
  plan: TravelPlan,
  stops: TripStop[],
  places: CollectedPlace[],
): TimelineYear[] {
  const placeMap = new Map(places.map((p) => [p.id, p]))
  const dayCount = Math.max(1, plan.dayCount || 1)
  const years: TimelineYear[] = []
  const start = parseDatePart(plan.startDate)
  if (!start) return years

  for (let i = 0; i < dayCount; i += 1) {
    const datePart = datePartOfDay(plan.startDate, i)
    const day = parseDatePart(datePart)
    if (!day) continue
    const yKey = String(day.getFullYear())
    let year = years[years.length - 1]
    if (!year || year.key !== yKey) {
      year = { key: yKey, label: `${day.getFullYear()}年`, days: [] }
      years.push(year)
    }
    const dayStops = stops
      .filter((s) => s.dayIndex === i)
      .flatMap((stop) => {
        const collected = placeMap.get(stop.placeId)
        if (!collected) return []
        return [{ ...stop, place: collected.place, collected }]
      })
    year.days.push({
      key: `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
      dayIndex: i,
      datePart,
      label: `${day.getMonth() + 1}月${day.getDate()}日`,
      weekday: WEEKDAYS[day.getDay()],
      stops: dayStops,
    })
  }
  return years
}

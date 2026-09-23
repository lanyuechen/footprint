import type { CollectedPlace, TravelPlan, TripStop } from '../types'
import { buildTripDays } from '../features/trip/trip-days'
import {
  listAllPlacesByPlan,
  listStopsByPlan,
} from '../services/storage'

/** 备注写成 Markdown 引用；多行时每行前加 > */
function noteAsBlockquote(note: string): string[] {
  const lines = note.split(/\r?\n/)
  return lines.map((line) => `   > ${line}`)
}

/**
 * 将计划行程导出为可分享的 Markdown。
 * 始终导出全部行程点，不受类型筛选等 UI 状态影响。
 */
export function planToMarkdown(
  plan: TravelPlan,
  stops?: TripStop[],
  places?: CollectedPlace[],
): string {
  const allStops = stops ?? listStopsByPlan(plan.id)
  const allPlaces = places ?? listAllPlacesByPlan(plan.id)

  const lines: string[] = []
  lines.push(`# ${plan.name || '未命名计划'}`)
  lines.push('')

  if (plan.description?.trim()) {
    lines.push(plan.description.trim())
    lines.push('')
  }

  if (plan.startDate) {
    const dayCount = Math.max(1, plan.dayCount || 1)
    lines.push(`> ${plan.startDate} 起 · 共 ${dayCount} 天`)
    lines.push('')
  }

  const years = buildTripDays(plan, allStops, allPlaces)
  if (years.length === 0) {
    lines.push('_暂无行程_')
    lines.push('')
    return `${lines.join('\n').trimEnd()}\n`
  }

  for (const year of years) {
    lines.push(`## ${year.label}`)
    lines.push('')
    for (const day of year.days) {
      lines.push(`### ${day.label}（${day.weekday}）`)
      lines.push('')
      if (day.stops.length === 0) {
        lines.push('_暂无安排_')
        lines.push('')
        continue
      }
      day.stops.forEach((stop, index) => {
        const time = stop.time?.trim() || ''
        const title = stop.place.name || '未命名地点'
        lines.push(`${index + 1}. **${title}**${time ? ` · ${time}` : ''}`)
        const note = stop.note?.trim() || ''
        if (note) {
          lines.push(...noteAsBlockquote(note))
        }
      })
      lines.push('')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

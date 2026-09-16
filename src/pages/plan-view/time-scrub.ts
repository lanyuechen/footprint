import type { TargetPoint } from '../../types'

export type HourSlot = {
  year: number
  month: number
  date: number
  hour: number
  dayLabel: string
  weekday: string
  yearLabel: string
  showYear: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
}

/** 起止日期之间每一天的 0 点到 23 点，中间空日期也包含 */
export function buildHourSlots(points: TargetPoint[]): HourSlot[] {
  let start: Date | null = null
  let end: Date | null = null
  for (const point of points) {
    const d = new Date(point.expectedAt)
    if (Number.isNaN(d.getTime())) continue
    const day = dayStart(d)
    if (!start || day.getTime() < start.getTime()) start = day
    if (!end || day.getTime() > end.getTime()) end = day
  }
  if (!start || !end) return []

  const slots: HourSlot[] = []
  let yearSeen = -1
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDay(cursor)) {
    const year = cursor.getFullYear()
    const showYear = year !== yearSeen
    yearSeen = year
    for (let hour = 0; hour < 24; hour += 1) {
      slots.push({
        year,
        month: cursor.getMonth() + 1,
        date: cursor.getDate(),
        hour,
        dayLabel: `${cursor.getMonth() + 1}月${cursor.getDate()}日`,
        weekday: WEEKDAYS[cursor.getDay()],
        yearLabel: `${year}年`,
        showYear: showYear && hour === 0,
      })
    }
  }
  return slots
}

export function slotIndexOf(slots: HourSlot[], iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || slots.length === 0) return 0
  const index = slots.findIndex(
    (slot) =>
      slot.year === d.getFullYear() &&
      slot.month === d.getMonth() + 1 &&
      slot.date === d.getDate() &&
      slot.hour === d.getHours(),
  )
  return index < 0 ? 0 : index
}

export function formatSlotLabel(slot: HourSlot) {
  return `${slot.year}年${slot.month}月${slot.date}日 ${slot.hour}:00`
}

export function formatSlotClock(slot: HourSlot) {
  return `${slot.hour}:00`
}

/** 每个整点上已有地点卡片的名称，同一小时按列表顺序拼接 */
export function slotPlaceNames(slots: HourSlot[], points: TargetPoint[]) {
  const grouped = new Map<number, string[]>()
  for (const point of points) {
    const name = point.place.name?.trim()
    if (!name) continue
    const index = slotIndexOf(slots, point.expectedAt)
    const list = grouped.get(index)
    if (list) list.push(name)
    else grouped.set(index, [name])
  }
  return slots.map((_, index) => (grouped.get(index) || []).join('、'))
}

export type SlotMark = {
  start: number
  label: string
}

export function slotMarks(slots: HourSlot[]): SlotMark[] {
  const days: SlotMark[] = []
  slots.forEach((slot, index) => {
    const prev = slots[index - 1]
    if (!prev || slot.year !== prev.year || slot.month !== prev.month || slot.date !== prev.date) {
      days.push({ start: index, label: `${slot.year}年${slot.month}月${slot.date}日` })
    }
  })
  return days
}

const TICK_FOCAL = 2.4

/** 相对选中刻度的屏幕偏移。中间行距最大，越靠近两端越密 */
export function tickOffset(delta: number, rowH: number, half: number) {
  const raw = rowH * TICK_FOCAL * Math.atan(delta / TICK_FOCAL)
  const span = rowH * TICK_FOCAL * (Math.PI / 2)
  const limit = Math.max(rowH, half * 0.92)
  if (span <= limit) return raw
  return (raw * limit) / span
}

export function tickSpacing(delta: number, rowH: number, half: number) {
  const x = delta / TICK_FOCAL
  const space = rowH / (1 + x * x)
  const span = rowH * TICK_FOCAL * (Math.PI / 2)
  const limit = Math.max(rowH, half * 0.92)
  if (span <= limit) return space
  return (space * limit) / span
}

/** 日期吸在指针上方一行；下一天顶上来时被推走 */
export function stickyMarkTop(
  start: number,
  nextStart: number | null,
  scrollIndex: number,
  centerY: number,
  half: number,
  rowH: number,
) {
  const labelTop = (index: number) =>
    centerY + tickOffset(index - scrollIndex, rowH, half) - 1.5 * rowH
  const natural = labelTop(start)
  const nextNatural = nextStart == null ? Number.POSITIVE_INFINITY : labelTop(nextStart)
  const stickY = centerY - 1.5 * rowH
  return Math.min(Math.max(natural, stickY), nextNatural - rowH)
}

export function hourIndexFromY(y: number, top: number, height: number, count: number) {
  if (count <= 1) return 0
  const slot = height / count
  const index = Math.round((y - top) / slot - 0.5)
  return Math.min(count - 1, Math.max(0, index))
}

/** 整点，分钟为 00；同一小时已有地点时排在后面 */
export function expectedAtForSlot(slot: HourSlot, points: TargetPoint[], selfId: string) {
  let latest = new Date(slot.year, slot.month - 1, slot.date, slot.hour, 0, 0, 0).getTime()
  for (const point of points) {
    if (point.id === selfId) continue
    const d = new Date(point.expectedAt)
    if (Number.isNaN(d.getTime())) continue
    if (
      d.getFullYear() !== slot.year ||
      d.getMonth() + 1 !== slot.month ||
      d.getDate() !== slot.date ||
      d.getHours() !== slot.hour
    ) {
      continue
    }
    if (d.getTime() >= latest) latest = d.getTime() + 1
  }
  return new Date(latest).toISOString()
}

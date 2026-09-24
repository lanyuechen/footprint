export type NoteDisplayPart =
  | { type: 'text'; text: string }
  | { type: 'warn'; text: string }

/**
 * 卡片备注展示解析：
 * 「注意：」/「注意:」仅作标识不展示，其后到换行前的文字为警告段。
 */
export function parseNoteForDisplay(note: string): NoteDisplayPart[] {
  const raw = note || ''
  if (!raw) return []

  const parts: NoteDisplayPart[] = []
  const re = /注意[:：]([^\n]*)/g
  let last = 0
  for (const m of raw.matchAll(re)) {
    const index = m.index ?? 0
    if (index > last) {
      parts.push({ type: 'text', text: raw.slice(last, index) })
    }
    const warn = (m[1] || '').trim()
    if (warn) parts.push({ type: 'warn', text: warn })
    last = index + m[0].length
  }
  if (last < raw.length) {
    parts.push({ type: 'text', text: raw.slice(last) })
  }
  return parts
}

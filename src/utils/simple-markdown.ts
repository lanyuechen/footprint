/** 轻量 Markdown AST（计划描述用） */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }

export type MdListItem = {
  children: MdInline[]
  /** 仅任务列表：false 未勾选 / true 已勾选 */
  checked?: boolean
}

export type MdBlock =
  | { type: 'p'; lines: MdInline[][] }
  | { type: 'h'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'ul'; items: MdListItem[] }
  | { type: 'ol'; items: MdListItem[] }
  | { type: 'task'; items: Array<{ checked: boolean; children: MdInline[] }> }
  | { type: 'quote'; lines: MdInline[][] }
  | { type: 'hr' }

function isHrLine(line: string): boolean {
  const t = line.trim()
  return /^(-{3,}|\*{3,}|_{3,})$/.test(t)
}

function parseInline(raw: string): MdInline[] {
  const out: MdInline[] = []
  let i = 0
  let buf = ''

  const flush = () => {
    if (!buf) return
    out.push({ type: 'text', text: buf })
    buf = ''
  }

  while (i < raw.length) {
    // **bold**
    if (raw[i] === '*' && raw[i + 1] === '*') {
      const end = raw.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({
          type: 'strong',
          children: parseInline(raw.slice(i + 2, end)),
        })
        i = end + 2
        continue
      }
    }
    // __bold__
    if (raw[i] === '_' && raw[i + 1] === '_') {
      const end = raw.indexOf('__', i + 2)
      if (end > i + 2) {
        flush()
        out.push({
          type: 'strong',
          children: parseInline(raw.slice(i + 2, end)),
        })
        i = end + 2
        continue
      }
    }
    // *italic*（非 **）
    if (raw[i] === '*' && raw[i + 1] !== '*') {
      let end = i + 1
      while (end < raw.length) {
        if (raw[end] === '*' && raw[end - 1] !== '\\') break
        end++
      }
      if (end < raw.length && end > i + 1) {
        flush()
        out.push({
          type: 'em',
          children: parseInline(raw.slice(i + 1, end)),
        })
        i = end + 1
        continue
      }
    }
    // _italic_（非 __）
    if (raw[i] === '_' && raw[i + 1] !== '_') {
      let end = i + 1
      while (end < raw.length) {
        if (raw[end] === '_' && raw[end - 1] !== '\\') break
        end++
      }
      if (end < raw.length && end > i + 1) {
        flush()
        out.push({
          type: 'em',
          children: parseInline(raw.slice(i + 1, end)),
        })
        i = end + 1
        continue
      }
    }
    buf += raw[i]
    i++
  }
  flush()
  return out
}

type LineKind =
  | { kind: 'empty' }
  | { kind: 'hr' }
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'task'; checked: boolean; text: string }
  | { kind: 'ul'; text: string }
  | { kind: 'ol'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'text'; text: string }

function classifyLine(line: string): LineKind {
  if (!line.trim()) return { kind: 'empty' }
  if (isHrLine(line)) return { kind: 'hr' }

  const h = /^(#{1,3})\s+(.*)$/.exec(line)
  if (h) {
    return {
      kind: 'h',
      level: h[1]!.length as 1 | 2 | 3,
      text: h[2] ?? '',
    }
  }

  // - [ ] / - [x] / * [X]
  const task = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
  if (task) {
    return {
      kind: 'task',
      checked: /x/i.test(task[1] || ''),
      text: task[2] ?? '',
    }
  }

  const ul = /^[-*]\s+(.*)$/.exec(line)
  if (ul) return { kind: 'ul', text: ul[1] ?? '' }

  const ol = /^\d+\.\s+(.*)$/.exec(line)
  if (ol) return { kind: 'ol', text: ol[1] ?? '' }

  const q = /^>\s?(.*)$/.exec(line)
  if (q) return { kind: 'quote', text: q[1] ?? '' }

  return { kind: 'text', text: line }
}

/**
 * 轻量 Markdown：
 * - 空行分段；单换行 = 硬换行
 * - 标题 #～###；加粗/斜体；列表；任务勾选；引用；分割线
 */
export function parseSimpleMarkdown(source: string): MdBlock[] {
  const lines = (source || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let i = 0

  const pushParagraph = (paraLines: string[]) => {
    if (paraLines.length === 0) return
    blocks.push({
      type: 'p',
      lines: paraLines.map((l) => parseInline(l)),
    })
  }

  while (i < lines.length) {
    const kind = classifyLine(lines[i]!)

    if (kind.kind === 'empty') {
      i++
      continue
    }

    if (kind.kind === 'hr') {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    if (kind.kind === 'h') {
      blocks.push({
        type: 'h',
        level: kind.level,
        children: parseInline(kind.text),
      })
      i++
      continue
    }

    if (kind.kind === 'task') {
      const items: Array<{ checked: boolean; children: MdInline[] }> = []
      while (i < lines.length) {
        const cur = classifyLine(lines[i]!)
        if (cur.kind !== 'task') break
        items.push({
          checked: cur.checked,
          children: parseInline(cur.text),
        })
        i++
      }
      blocks.push({ type: 'task', items })
      continue
    }

    if (kind.kind === 'ul' || kind.kind === 'ol') {
      const listKind = kind.kind
      const items: MdListItem[] = []
      while (i < lines.length) {
        const cur = classifyLine(lines[i]!)
        if (cur.kind !== listKind) break
        items.push({ children: parseInline(cur.text) })
        i++
      }
      blocks.push(
        listKind === 'ul' ? { type: 'ul', items } : { type: 'ol', items },
      )
      continue
    }

    if (kind.kind === 'quote') {
      const qLines: string[] = []
      while (i < lines.length) {
        const cur = classifyLine(lines[i]!)
        if (cur.kind === 'empty') break
        if (cur.kind !== 'quote') break
        qLines.push(cur.text)
        i++
      }
      blocks.push({
        type: 'quote',
        lines: qLines.map((l) => parseInline(l)),
      })
      continue
    }

    // 普通段落：连续 text 行，中间无空行 → 硬换行
    const para: string[] = []
    while (i < lines.length) {
      const cur = classifyLine(lines[i]!)
      if (cur.kind !== 'text') break
      para.push(cur.text)
      i++
    }
    pushParagraph(para)
  }

  return blocks
}

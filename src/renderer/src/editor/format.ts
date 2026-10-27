// Formatting commands behind the Format menu and shortcuts.
import { EditorSelection, type ChangeSpec, type SelectionRange } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { cellOffset, columnAt, editTable, emptyTable, formatTable, isDelimiterRow, isTableLine, lineOfRow, parseTable, renderTable, rowOfLine, type TableOp } from '../markdown/table'

function wordAt(view: EditorView, range: SelectionRange) {
  if (!range.empty) return range
  const w = view.state.wordAt(range.head)
  return w ?? range
}

/** Wraps the selection (or the word at the caret) in a marker, or unwraps if already wrapped. */
export function toggleWrap(view: EditorView, open: string, close = open) {
  const { state } = view
  const tr = state.changeByRange((r0) => {
    const r = wordAt(view, r0)
    const text = state.sliceDoc(r.from, r.to)
    const before = state.sliceDoc(r.from - open.length, r.from)
    const after = state.sliceDoc(r.to, r.to + close.length)
    if (before === open && after === close) {
      return {
        changes: [
          { from: r.from - open.length, to: r.from },
          { from: r.to, to: r.to + close.length }
        ],
        range: EditorSelection.range(r.from - open.length, r.to - open.length)
      }
    }
    if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
      return {
        changes: { from: r.from, to: r.to, insert: text.slice(open.length, text.length - close.length) },
        range: EditorSelection.range(r.from, r.to - open.length - close.length)
      }
    }
    return {
      changes: [
        { from: r.from, insert: open },
        { from: r.to, insert: close }
      ],
      range: r.empty ? EditorSelection.cursor(r.from + open.length) : EditorSelection.range(r.from + open.length, r.to + open.length)
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
  view.focus()
}

function selectedLines(view: EditorView) {
  const { state } = view
  const lines = new Map<number, { from: number; text: string; number: number }>()
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos)
      lines.set(line.number, { from: line.from, text: line.text, number: line.number })
      pos = line.to + 1
    }
  }
  return [...lines.values()]
}

const PREFIX_RE = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

/** Sets a block prefix ("> ", "- ", "1. ", "- [ ] ", "## ") on the selected lines, toggling it off if all have it. */
export function setLinePrefix(view: EditorView, kind: 'quote' | 'bullet' | 'number' | 'task' | 'heading', level = 0) {
  const lines = selectedLines(view)
  const want = (i: number) =>
    kind === 'quote' ? '> ' : kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : kind === 'task' ? '- [ ] ' : level ? '#'.repeat(level) + ' ' : ''
  const has = (prefix: string) =>
    kind === 'quote' ? /^>/.test(prefix) : kind === 'bullet' ? /^[-*+]\s+(?!\[)/.test(prefix) : kind === 'number' ? /^\d/.test(prefix) : kind === 'task' ? /\[[ xX]\]/.test(prefix) : prefix === want(0)
  const all = lines.every((l) => has(PREFIX_RE.exec(l.text)![2] ?? ''))
  const changes: ChangeSpec[] = lines.map((l, i) => {
    const m = PREFIX_RE.exec(l.text)!
    const indent = m[1]
    const existing = m[2] ?? ''
    // Headings replace any block prefix; quotes stack on top of lists.
    const keep = kind === 'quote' && !/^>/.test(existing) ? existing : ''
    const insert = all ? keep : want(i) + keep
    return { from: l.from + indent.length, to: l.from + indent.length + existing.length, insert }
  })
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true })
  view.focus()
}

export function toggleTask(view: EditorView) {
  const changes: ChangeSpec[] = []
  for (const l of selectedLines(view)) {
    const m = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(l.text)
    if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[1].length + 1, insert: m[2] === ' ' ? 'x' : ' ' })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input.format' })
  else setLinePrefix(view, 'task')
}

export async function insertLink(view: EditorView, wiki = false) {
  const { state } = view
  const r = wordAt(view, state.selection.main)
  const text = state.sliceDoc(r.from, r.to)
  if (wiki) {
    view.dispatch({ changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, selection: { anchor: r.from + 2 + text.length + (text ? 2 : 0) } })
    view.focus()
    return
  }
  let url = ''
  try {
    const clip = (await navigator.clipboard.readText()).trim()
    if (/^(https?:|mailto:)\S+$/.test(clip)) url = clip
  } catch {
    // Clipboard may be unavailable.
  }
  if (/^(https?:|mailto:)\S+$/.test(text)) {
    view.dispatch({ changes: { from: r.from, to: r.to, insert: `[](${text})` }, selection: { anchor: r.from + 1 } })
  } else {
    const insert = `[${text}](${url})`
    const anchor = url ? r.from + insert.length : text ? r.from + text.length + 3 : r.from + 1
    view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor } })
  }
  view.focus()
}

export function insertFootnote(view: EditorView) {
  const { state } = view
  const doc = state.doc.toString()
  let n = 1
  while (doc.includes(`[^${n}]`)) n++
  const pos = state.selection.main.head
  const tail = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n'
  const note = `${tail}[^${n}]: `
  view.dispatch({
    changes: [
      { from: pos, insert: `[^${n}]` },
      { from: doc.length, insert: note }
    ],
    selection: { anchor: doc.length + `[^${n}]`.length + note.length },
    scrollIntoView: true
  })
  view.focus()
}

export function insertCodeBlock(view: EditorView) {
  const { state } = view
  const r = state.selection.main
  const from = state.doc.lineAt(r.from)
  const to = state.doc.lineAt(r.to)
  const body = state.sliceDoc(from.from, to.to)
  const insert = '```\n' + body + (body ? '\n' : '') + '```'
  view.dispatch({ changes: { from: from.from, to: to.to, insert }, selection: { anchor: from.from + 3 } })
  view.focus()
}

export function insertText(view: EditorView, text: string, block = false) {
  const { state } = view
  const r = state.selection.main
  let insert = text
  if (block) {
    const line = state.doc.lineAt(r.from)
    const pre = line.text.trim() && r.from > line.from ? '\n\n' : r.from > 0 && state.doc.lineAt(r.from - 1).text.trim() && !line.text.trim() ? '\n' : ''
    insert = pre + text + '\n'
  }
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + insert.length }, scrollIntoView: true })
  view.focus()
}

export function insertTable(view: EditorView) {
  insertText(view, emptyTable(), true)
}

interface TableAt {
  from: number
  to: number
  lines: string[]
  /** Index of the caret's line within `lines`. */
  index: number
  col: number
}

/** The pipe table around the caret, if any. */
export function tableAt(view: EditorView): TableAt | null {
  const { state } = view
  const head = state.selection.main.head
  const here = state.doc.lineAt(head)
  if (!isTableLine(here.text) && !isDelimiterRow(here.text)) return null
  let a = here.number
  let b = here.number
  while (a > 1 && isTableLine(state.doc.line(a - 1).text)) a--
  while (b < state.doc.lines && isTableLine(state.doc.line(b + 1).text)) b++
  const lines: string[] = []
  for (let i = a; i <= b; i++) lines.push(state.doc.line(i).text)
  if (!lines.some(isDelimiterRow)) return null
  return { from: state.doc.line(a).from, to: state.doc.line(b).to, lines, index: here.number - a, col: columnAt(here.text, head - here.from) }
}

/** Replaces the table and puts the caret at the start of cell (row, col). */
function writeTable(view: EditorView, t: TableAt, lines: string[], row: number, col: number) {
  const text = lines.join('\n')
  const lineIndex = lineOfRow(row)
  const anchor = t.from + lines.slice(0, lineIndex).reduce((n, l) => n + l.length + 1, 0) + cellOffset(lines[lineIndex], col)
  view.dispatch({ changes: { from: t.from, to: t.to, insert: text }, selection: { anchor }, userEvent: 'input.format', scrollIntoView: true })
}

/** Aligns the pipe table under the caret. Returns false if the caret isn't in a table. */
export function tidyTable(view: EditorView): boolean {
  const t = tableAt(view)
  if (!t) return false
  const formatted = formatTable(t.lines)
  if (formatted.join('\n') !== t.lines.join('\n')) writeTable(view, t, formatted, rowOfLine(t.index), t.col)
  return true
}

export function editTableAt(view: EditorView, op: TableOp): boolean {
  const t = tableAt(view)
  if (!t) return false
  const r = editTable(parseTable(t.lines), op, rowOfLine(t.index), t.col)
  writeTable(view, t, renderTable(r.table), r.row, r.col)
  view.focus()
  return true
}

/** Tab / Shift-Tab move between cells, tidying as they go; Tab past the last cell adds a row. */
export function tableNextCell(view: EditorView, dir: 1 | -1): boolean {
  const t = tableAt(view)
  if (!t || !view.state.selection.main.empty) return false
  let model = parseTable(t.lines)
  const cols = model.align.length
  let row = rowOfLine(t.index)
  let col = t.col + dir
  if (col >= cols) {
    col = 0
    row++
  } else if (col < 0) {
    col = cols - 1
    row--
  }
  if (row < 0) return true
  if (row >= model.rows.length) model = editTable(model, 'rowBelow', model.rows.length - 1, 0).table
  writeTable(view, t, renderTable(model), row, col)
  return true
}

// ------------------------------------------------------------------ inserts

export function insertDate(view: EditorView) {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  insertText(view, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

export function insertBlock(view: EditorView, text: string, caretOffset = text.length) {
  const { state } = view
  const r = state.selection.main
  const line = state.doc.lineAt(r.from)
  const before = line.text.trim() ? '\n\n' : r.from > 0 && state.doc.lineAt(r.from - 1).text.trim() ? '\n' : ''
  const at = line.text.trim() ? line.to : line.from
  const insert = before + text + '\n'
  view.dispatch({ changes: { from: at, to: line.text.trim() ? at : line.to, insert }, selection: { anchor: at + before.length + caretOffset }, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
}

export async function insertImageLink(view: EditorView) {
  let url = ''
  try {
    const clip = (await navigator.clipboard.readText()).trim()
    if (/^https?:\/\/\S+$/.test(clip)) url = clip
  } catch {
    // Clipboard unavailable.
  }
  const { state } = view
  const r = state.selection.main
  const alt = state.sliceDoc(r.from, r.to)
  const insert = `![${alt}](${url})`
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: alt || !url ? r.from + 2 + alt.length + (alt ? 2 : 0) : r.from + 2 }, userEvent: 'input.format' })
  view.focus()
}

/** Wraps the selection in an HTML comment, or removes the comment around it. */
export function toggleComment(view: EditorView) {
  const { state } = view
  const r = state.selection.main
  const from = r.empty ? state.doc.lineAt(r.from).from : r.from
  const to = r.empty ? state.doc.lineAt(r.to).to : r.to
  const text = state.sliceDoc(from, to)
  const m = /^<!--\s?([\s\S]*?)\s?-->$/.exec(text)
  const insert = m ? m[1] : `<!-- ${text} -->`
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from, head: from + insert.length }, userEvent: 'input.format' })
  view.focus()
}

export const CALLOUTS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type Callout = (typeof CALLOUTS)[number]

/** Turns the selected lines into a callout (GitHub alert syntax), or retypes an existing one. */
export function insertCallout(view: EditorView, kind: Callout) {
  const { state } = view
  const r = state.selection.main
  const first = state.doc.lineAt(r.from)
  const last = state.doc.lineAt(r.to)
  const marker = `> [!${kind.toUpperCase()}]`
  if (/^>\s*\[!\w+\]/.test(first.text)) {
    view.dispatch({ changes: { from: first.from, to: first.to, insert: first.text.replace(/^>\s*\[!\w+\]/, marker) } })
    return view.focus()
  }
  const body = state.sliceDoc(first.from, last.to)
  const quoted = body.split('\n').map((l) => (/^>/.test(l) ? l : `> ${l}`.trimEnd() || '>')).join('\n')
  const insert = `${marker}\n${body.trim() ? quoted : '> '}`
  view.dispatch({ changes: { from: first.from, to: last.to, insert }, selection: { anchor: first.from + insert.length }, userEvent: 'input.format' })
  view.focus()
}

// Pipe table tidying: aligns columns and normalises the delimiter row.

const width = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let code = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (ch === '`') {
      code = !code
      cur += ch
    } else if (ch === '|' && !code) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

export function isTableLine(line: string) {
  return /^\s*\|.*\|\s*$/.test(line) || (/\|/.test(line) && /^\s*\S/.test(line) && splitRow(line).length > 1)
}

export function isDelimiterRow(line: string) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
}

export function formatTable(lines: string[]): string[] {
  const rows = lines.map(splitRow)
  const delimIndex = lines.findIndex(isDelimiterRow)
  const cols = Math.max(...rows.map((r) => r.length))
  const align: ('l' | 'c' | 'r' | '')[] = []
  if (delimIndex >= 0) {
    rows[delimIndex].forEach((c, i) => {
      const l = c.startsWith(':')
      const r = c.endsWith(':')
      align[i] = l && r ? 'c' : r ? 'r' : l ? 'l' : ''
    })
  }
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, ...rows.filter((_, ri) => ri !== delimIndex).map((r) => width(r[i] ?? '')))
  )
  return rows.map((r, ri) => {
    const cells = widths.map((w, i) => {
      if (ri === delimIndex) {
        const a = align[i] ?? ''
        const dashes = '-'.repeat(w - (a === 'c' ? 2 : a ? 1 : 0))
        return a === 'c' ? `:${dashes}:` : a === 'r' ? `${dashes}:` : a === 'l' ? `:${dashes}` : dashes
      }
      const c = r[i] ?? ''
      const pad = w - width(c)
      if (align[i] === 'r') return ' '.repeat(pad) + c
      if (align[i] === 'c') return ' '.repeat(Math.floor(pad / 2)) + c + ' '.repeat(Math.ceil(pad / 2))
      return c + ' '.repeat(pad)
    })
    return `| ${cells.join(' | ')} |`
  })
}

export function emptyTable(cols = 3, rows = 2): string {
  const head = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`)
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  for (let r = 0; r < rows; r++) lines.push(`| ${head.map(() => ' ').join(' | ')} |`)
  return formatTable(lines).join('\n')
}

// ------------------------------------------------------------------ table editing

export type Align = 'l' | 'c' | 'r' | ''

/** A table as data: `rows[0]` is the header row. */
export interface TableModel {
  rows: string[][]
  align: Align[]
}

export function parseTable(lines: string[]): TableModel {
  const delim = lines.findIndex(isDelimiterRow)
  const rows = lines.filter((_, i) => i !== delim).map(splitRow)
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const align: Align[] = Array.from({ length: cols }, (_, i) => {
    const c = delim >= 0 ? splitRow(lines[delim])[i] ?? '' : ''
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'c' : r ? 'r' : l ? 'l' : ''
  })
  return { rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')), align }
}

export function renderTable(t: TableModel): string[] {
  const delim = `| ${t.align.map((a) => (a === 'c' ? ':-:' : a === 'r' ? '--:' : a === 'l' ? ':--' : '---')).join(' | ')} |`
  const lines = t.rows.map((r) => `| ${r.join(' | ')} |`)
  lines.splice(1, 0, delim)
  return formatTable(lines)
}

/** Table row (0 = header) for a line index within the table's lines; the delimiter maps to the header. */
export const rowOfLine = (line: number) => (line <= 1 ? 0 : line - 1)
export const lineOfRow = (row: number) => (row === 0 ? 0 : row + 1)

/** Column under a character offset in a table line. */
export function columnAt(line: string, offset: number): number {
  let col = -1
  let code = false
  const start = line.trimStart().startsWith('|') ? 0 : -1
  if (start < 0) col = 0
  for (let i = 0; i < Math.min(offset, line.length); i++) {
    if (line[i] === '`') code = !code
    else if (line[i] === '|' && line[i - 1] !== '\\' && !code) col++
  }
  return Math.max(0, col)
}

/** Character offset where cell `col` starts in a formatted line. */
export function cellOffset(line: string, col: number): number {
  let seen = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') {
      seen++
      if (seen === col) return Math.min(line.length, i + 2)
    }
  }
  return line.length
}

export type TableOp =
  | 'rowAbove' | 'rowBelow' | 'deleteRow' | 'rowUp' | 'rowDown'
  | 'colBefore' | 'colAfter' | 'deleteCol' | 'colLeft' | 'colRight'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'sortAsc' | 'sortDesc' | 'transpose'

const swap = <T>(a: T[], i: number, j: number) => ([a[i], a[j]] = [a[j], a[i]])

/** Applies an edit; returns the new table and where the caret should go. */
export function editTable(t: TableModel, op: TableOp, row: number, col: number): { table: TableModel; row: number; col: number } {
  const rows = t.rows.map((r) => [...r])
  const align = [...t.align]
  const cols = align.length
  const blank = () => Array.from({ length: align.length }, () => '')
  switch (op) {
    case 'rowAbove':
      rows.splice(Math.max(1, row), 0, blank())
      return { table: { rows, align }, row: Math.max(1, row), col }
    case 'rowBelow':
      rows.splice(row + 1, 0, blank())
      return { table: { rows, align }, row: row + 1, col }
    case 'deleteRow':
      if (row === 0 || rows.length <= 2) return { table: t, row, col }
      rows.splice(row, 1)
      return { table: { rows, align }, row: Math.min(row, rows.length - 1), col }
    case 'rowUp':
      if (row <= 1) return { table: t, row, col }
      swap(rows, row, row - 1)
      return { table: { rows, align }, row: row - 1, col }
    case 'rowDown':
      if (row === 0 || row >= rows.length - 1) return { table: t, row, col }
      swap(rows, row, row + 1)
      return { table: { rows, align }, row: row + 1, col }
    case 'colBefore':
    case 'colAfter': {
      const at = op === 'colBefore' ? col : col + 1
      rows.forEach((r) => r.splice(at, 0, ''))
      align.splice(at, 0, '')
      return { table: { rows, align }, row, col: at }
    }
    case 'deleteCol':
      if (cols <= 1) return { table: t, row, col }
      rows.forEach((r) => r.splice(col, 1))
      align.splice(col, 1)
      return { table: { rows, align }, row, col: Math.min(col, align.length - 1) }
    case 'colLeft':
    case 'colRight': {
      const to = op === 'colLeft' ? col - 1 : col + 1
      if (to < 0 || to >= cols) return { table: t, row, col }
      rows.forEach((r) => swap(r, col, to))
      swap(align, col, to)
      return { table: { rows, align }, row, col: to }
    }
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight':
      align[col] = op === 'alignLeft' ? 'l' : op === 'alignCenter' ? 'c' : 'r'
      return { table: { rows, align }, row, col }
    case 'sortAsc':
    case 'sortDesc': {
      const [head, ...body] = rows
      const num = (s: string) => Number(s.replace(/[,\s]/g, ''))
      const numeric = body.every((r) => r[col] === '' || !isNaN(num(r[col])))
      body.sort((a, b) => (numeric ? num(a[col]) - num(b[col]) : a[col].localeCompare(b[col], undefined, { numeric: true, sensitivity: 'base' })))
      if (op === 'sortDesc') body.reverse()
      return { table: { rows: [head, ...body], align }, row, col }
    }
    case 'transpose': {
      const out = Array.from({ length: cols }, (_, c) => rows.map((r) => r[c]))
      return { table: { rows: out, align: Array.from({ length: rows.length }, () => '' as Align) }, row: col, col: row }
    }
  }
}

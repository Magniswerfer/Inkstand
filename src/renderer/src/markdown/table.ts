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

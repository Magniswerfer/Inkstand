// Small text helpers used by both the library scanner (main) and the editor (renderer).

export const TEXT_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'txt', 'text']

export function isTextFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return name.includes('.') && TEXT_EXTENSIONS.includes(ext)
}

export const TAG_RE = /(?<![\p{L}\p{N}_#&/\\])#([\p{L}_][\p{L}\p{N}_\-/]*)/gu

/** Hashtags in a document, ignoring fenced code and headings. */
export function extractTags(text: string): string[] {
  const tags = new Set<string>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const body = line.replace(/`[^`]*`/g, '').replace(/^#{1,6}\s/, '')
    for (const m of body.matchAll(TAG_RE)) tags.add(m[1].replace(/[-/]+$/, '').toLowerCase())
  }
  return [...tags]
}

/** Strip a leading YAML front matter block, returning it separately. */
export function splitFrontMatter(text: string): { frontMatter: string; body: string; offset: number } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text)
  if (!m) return { frontMatter: '', body: text, offset: 0 }
  return { frontMatter: m[1], body: text.slice(m[0].length), offset: m[0].length }
}

/** A simple `key: value` front matter reader; good enough for title/author/date/tags. */
export function parseFrontMatter(fm: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z][\w -]*):\s*(.*)$/.exec(line)
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** Title of a document: front matter title, first heading, or first line. */
export function extractTitle(text: string, fallback = ''): string {
  const { frontMatter, body } = splitFrontMatter(text)
  const fmTitle = parseFrontMatter(frontMatter).title
  if (fmTitle) return fmTitle
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    return stripInline(line.replace(/^#{1,6}\s+/, '').replace(/^[>*+-]\s+/, '')).slice(0, 120)
  }
  return fallback
}

/** The opening text of a document; `fromStart` keeps the first line (the library shows it under the file name). */
export function extractExcerpt(text: string, max = 160, fromStart = false): string {
  const { body } = splitFrontMatter(text)
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const rest = lines.slice(fromStart ? 0 : 1).filter((l) => !/^(```|~~~|---|\||<!--)/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, ''))
  return stripInline(rest.join(' ').replace(/^#{1,6}\s+/g, '')).slice(0, max)
}

export function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|==|`)/g, '')
}

/** Turn a title into a safe file name (keeps unicode letters, drops path characters). */
export function fileNameFromTitle(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean || 'Untitled'
}

// ------------------------------------------------------------------ authorship block

const AUTHORSHIP_RE = /\n*<!-- Authorship · FOSS Write\n([\s\S]*?)\n-->\s*$/

/** Separates a document's text from its trailing authorship block, if any. */
export function splitAuthorship(text: string): { body: string; block: string | null } {
  const m = AUTHORSHIP_RE.exec(text)
  if (!m) return { body: text, block: null }
  return { body: text.slice(0, m.index) + '\n', block: m[1] }
}

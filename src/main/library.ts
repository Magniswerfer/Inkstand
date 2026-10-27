import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join, basename } from 'node:path'
import type { DirEntry, FileSummary, SearchHit } from '@shared/types'
import { extractExcerpt, extractTags, extractTitle, isTextFile, splitAuthorship } from '@shared/text'

const SKIP = new Set(['node_modules', '.git', '.Trash', '.obsidian'])
const MAX_READ = 2 * 1024 * 1024

/** A document's text without its trailing authorship block. */
async function readText(path: string): Promise<string> {
  return splitAuthorship(await fs.readFile(path, 'utf8').catch(() => '')).body
}

function visible(name: string) {
  return !name.startsWith('.') && !SKIP.has(name)
}

async function entry(path: string): Promise<DirEntry | null> {
  try {
    const st = await fs.stat(path)
    return { path, name: basename(path), isDir: st.isDirectory(), mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size }
  } catch {
    return null
  }
}

export const stat = entry

/** Lists folders and text files in one directory, with titles and excerpts for the library list. */
export async function listDir(dir: string): Promise<FileSummary[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(visible)
  const out = await Promise.all(
    names.map(async (name): Promise<FileSummary | null> => {
      const e = await entry(join(dir, name))
      if (!e) return null
      if (e.isDir) return { ...e, title: name, excerpt: '', tags: [] }
      if (!isTextFile(name)) return null
      const text = e.size > MAX_READ ? '' : await readText(e.path)
      const base = name.replace(/\.[^.]+$/, '')
      return { ...e, title: extractTitle(text, base) || base, excerpt: extractExcerpt(text), tags: extractTags(text) }
    })
  )
  return out.filter((x): x is FileSummary => x !== null)
}

/** Every text file below the roots, used by quick open, wiki links and content block completion. */
export async function listAllFiles(root: string, includeAll = false): Promise<DirEntry[]> {
  const out: DirEntry[] = []
  async function walk(dir: string, depth: number) {
    if (depth > 12 || out.length > 20000) return
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      if (!visible(it.name)) continue
      const p = join(dir, it.name)
      if (it.isDirectory()) await walk(p, depth + 1)
      else if (includeAll || isTextFile(it.name)) {
        const e = await entry(p)
        if (e) out.push(e)
      }
    }
  }
  await walk(root, 0)
  return out
}

interface Query {
  terms: string[]
  phrases: string[]
  tags: string[]
  exclude: string[]
}

export function parseQuery(q: string): Query {
  const query: Query = { terms: [], phrases: [], tags: [], exclude: [] }
  for (const m of q.matchAll(/(-?)"([^"]+)"|(\S+)/g)) {
    if (m[2]) (m[1] ? query.exclude : query.phrases).push(m[2].toLowerCase())
    else if (m[3].startsWith('#') && m[3].length > 1) query.tags.push(m[3].slice(1).toLowerCase())
    else if (m[3].startsWith('-') && m[3].length > 1) query.exclude.push(m[3].slice(1).toLowerCase())
    else query.terms.push(m[3].toLowerCase())
  }
  return query
}

export function matches(text: string, name: string, q: Query): boolean {
  const hay = (name + '\n' + text).toLowerCase()
  if (q.exclude.some((t) => hay.includes(t))) return false
  if (![...q.terms, ...q.phrases].every((t) => hay.includes(t))) return false
  if (q.tags.length) {
    const tags = extractTags(text)
    if (!q.tags.every((t) => tags.some((x) => x === t || x.startsWith(t + '/')))) return false
  }
  return true
}

export async function search(roots: string[], raw: string): Promise<SearchHit[]> {
  const q = parseQuery(raw)
  if (!q.terms.length && !q.phrases.length && !q.tags.length) return []
  const needles = [...q.phrases, ...q.terms, ...q.tags.map((t) => '#' + t)]
  const hits: SearchHit[] = []
  for (const root of roots) {
    for (const f of await listAllFiles(root)) {
      if (f.size > MAX_READ) continue
      const text = await readText(f.path)
      if (!matches(text, f.name, q)) continue
      const lines = text.split('\n')
      let line = lines.findIndex((l) => needles.some((n) => l.toLowerCase().includes(n)))
      if (line < 0) line = 0
      hits.push({ path: f.path, name: f.name, title: extractTitle(text, f.name), mtime: f.mtime, line, snippet: lines[line]?.trim().slice(0, 200) ?? '' })
      if (hits.length >= 500) return hits
    }
  }
  return hits.sort((a, b) => b.mtime - a.mtime)
}

export async function tags(roots: string[]): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>()
  for (const root of roots) {
    for (const f of await listAllFiles(root)) {
      if (f.size > MAX_READ) continue
      const text = await readText(f.path)
      for (const t of extractTags(text)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag))
}

/** Watches a set of library folders, calling back (debounced) with the folder that changed. */
export class LibraryWatcher {
  private watchers: FSWatcher[] = []
  private timers = new Map<string, NodeJS.Timeout>()
  constructor(private onChange: (dir: string) => void) {}

  set(dirs: string[]) {
    this.close()
    for (const dir of dirs) {
      try {
        const w = watch(dir, { recursive: true }, (_e, file) => {
          if (file && file.split(/[\\/]/).some((p) => p.startsWith('.'))) return
          clearTimeout(this.timers.get(dir))
          this.timers.set(dir, setTimeout(() => this.onChange(dir), 300))
        })
        w.on('error', () => {})
        this.watchers.push(w)
      } catch {
        // Folder may have been removed; the library shows it as missing.
      }
    }
  }

  close() {
    for (const w of this.watchers) w.close()
    this.watchers = []
  }
}

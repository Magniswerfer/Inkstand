import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join, basename, dirname, extname } from 'node:path'
import type { DirEntry, FileSummary, SearchHit, SmartFolder, SmartRule } from '@shared/types'
import { matchQuery, parseQuery, queryTerms, type Node } from '@shared/query'
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
      return { ...e, title: extractTitle(text, base) || base, excerpt: extractExcerpt(text, 160, true), tags: extractTags(text) }
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

function hitFor(f: DirEntry, text: string, node: Node): SearchHit {
  const terms = queryTerms(node)
  const lines = text.split('\n')
  let line = terms.length ? lines.findIndex((l) => terms.some((n) => l.toLowerCase().includes(n))) : -1
  if (line < 0) line = 0
  return { path: f.path, name: f.name, title: extractTitle(text, f.name), mtime: f.mtime, line, snippet: lines[line]?.trim().slice(0, 200) ?? '' }
}

export async function search(roots: string[], raw: string): Promise<SearchHit[]> {
  const node = parseQuery(raw)
  if (node.t === 'all') return []
  const hits: SearchHit[] = []
  for (const root of roots) {
    for (const f of await listAllFiles(root, true)) {
      const text = isTextFile(f.name) && f.size <= MAX_READ ? await readText(f.path) : ''
      if (!matchQuery(node, { name: f.name, text })) continue
      hits.push(hitFor(f, text, node))
      if (hits.length >= 500) return hits
    }
  }
  return hits.sort((a, b) => b.mtime - a.mtime)
}

/** Every file and folder below the roots, for smart folder rules about kinds and paths. */
export async function walkAll(root: string): Promise<DirEntry[]> {
  const out: DirEntry[] = []
  async function walk(dir: string, depth: number) {
    if (depth > 12 || out.length > 20000) return
    for (const it of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!visible(it.name)) continue
      const e = await entry(join(dir, it.name))
      if (!e) continue
      out.push(e)
      if (e.isDir) await walk(e.path, depth + 1)
    }
  }
  await walk(root, 0)
  return out
}

/** Rule paths are relative to a library location ("/Notes"), or absolute. */
function rulePaths(value: string, roots: string[]): string[] {
  const v = value.trim().replace(/\/+$/, '')
  if (roots.some((r) => v === r || v.startsWith(r + '/'))) return [v]
  return roots.map((r) => (v === '' || v === '/' ? r : r + (v.startsWith('/') ? v : '/' + v)))
}

function dayStart(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? NaN : d.getTime()
}

function ruleMatches(rule: SmartRule, e: DirEntry, text: string, roots: string[], node: Node | null): boolean {
  const neg = rule.op === 'isNot' || rule.op === 'notInPast'
  let ok: boolean
  switch (rule.field) {
    case 'search':
      ok = node ? matchQuery(node, { name: e.name, text }) : true
      break
    case 'ancestorPath':
      ok = rulePaths(rule.value, roots).some((p) => e.path.startsWith(p + '/'))
      break
    case 'parentPath':
      ok = rulePaths(rule.value, roots).some((p) => dirname(e.path) === p)
      break
    case 'kind':
      ok = rule.value === 'folder' ? e.isDir : rule.value === 'text' ? !e.isDir && isTextFile(e.name) : !e.isDir && !isTextFile(e.name)
      break
    case 'extension':
      ok = !e.isDir && extname(e.name).slice(1).toLowerCase() === rule.value.replace(/^\./, '').toLowerCase()
      break
    case 'dateCreated':
    case 'dateModified': {
      const t = rule.field === 'dateCreated' ? e.ctime : e.mtime
      if (rule.op === 'inPast' || rule.op === 'notInPast') ok = Date.now() - t <= Number(rule.value) * 86_400_000
      else if (rule.op === 'after') ok = t >= dayStart(rule.value) + 86_400_000
      else ok = t < dayStart(rule.value)
      break
    }
  }
  return neg ? !ok : ok
}

export async function smartFolder(roots: string[], folder: SmartFolder): Promise<SearchHit[]> {
  const rules: SmartRule[] = folder.rules?.length ? folder.rules : [{ field: 'search', op: 'matches', value: folder.query }]
  const searchRule = rules.find((r) => r.field === 'search' && r.value.trim())
  const node = searchRule ? parseQuery(searchRule.value) : null
  const needsText = rules.some((r) => r.field === 'search')
  const hits: SearchHit[] = []
  for (const root of roots) {
    for (const e of await walkAll(root)) {
      const text = needsText && !e.isDir && isTextFile(e.name) && e.size <= MAX_READ ? await readText(e.path) : ''
      const results = rules.map((r) => ruleMatches(r, e, text, roots, r === searchRule ? node : r.field === 'search' ? parseQuery(r.value) : null))
      if (folder.match === 'any' ? !results.some(Boolean) : !results.every(Boolean)) continue
      hits.push(hitFor(e, text, node ?? { t: 'all' }))
      if (hits.length >= 1000) return hits.sort((a, b) => b.mtime - a.mtime)
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

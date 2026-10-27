// URL commands, modelled on iA Writer's (scheme version 6) so existing automations translate:
//
//   inkstand://open?path=/Notes/Idea.md[&new-window=true]
//   inkstand://new?path=/Inbox/&text=…[&author=ChatGPT][&new-window=true]
//   inkstand://quick-search?query=…
//   inkstand://read?auth-token=…&path=…                  → x-success: path, text
//   inkstand://write?auth-token=…&path=…&text=…&mode=create|replace|add|patch
//                      [&add-location=beginning|end][&add-padding=sentence|line|paragraph][&author=…]
//   inkstand://version                                   → x-success: scheme-version, app-version
//
// Every command also works as inkstand://x-callback-url/<command>?x-success=…&x-error=…
//
// Library paths: "/File.md" is in the first library location; "Ideas: File.md" is in the location
// named Ideas. Data commands need the auth token from Settings → General.
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseAuthorship, writeAuthorship, type AuthorEntry } from '@shared/authorship-file'
import { mapSpans, planEdits } from '@shared/edits'
import { extractTitle, fileNameFromTitle, isTextFile } from '@shared/text'
import type { AuthorKind, Span } from '@shared/types'
import { getSettings, setSettings } from './settings'

export const SCHEME = 'inkstand'
export const SCHEME_VERSION = '6'

export interface UrlHost {
  open(path: string, newWindow: boolean): void
  newDocument(newWindow: boolean): void
  quickSearch(query: string): void
}

export function urlToken(): string {
  let token = getSettings().urlToken
  if (!token) setSettings({ urlToken: (token = randomBytes(12).toString('hex')) })
  return token
}

/** "Ideas: Notes/File.md" or "/Notes/File.md" → an absolute path inside a library location. */
export function resolveLibraryPath(libraryPath: string, locations: string[]): string | null {
  const m = /^([^:/][^:]*):\s*(.*)$/.exec(libraryPath)
  const named = m ? locations.find((l) => basename(l) === m[1].trim() || (m[1].trim() === 'iCloud' && /~writer\/Documents$/.test(l))) : locations[0]
  if (!named) return null
  const rel = (m ? m[2] : libraryPath).replace(/^\/+/, '')
  const full = join(named, rel)
  // Never let ".." escape the location.
  return full === named || full.startsWith(named + '/') ? full + (libraryPath.endsWith('/') && rel ? '/' : '') : null
}

function toLibraryPath(path: string, locations: string[]): string {
  const loc = locations.find((l) => path.startsWith(l + '/'))
  if (!loc) return path
  return loc === locations[0] ? path.slice(loc.length) : `${basename(loc)}: ${path.slice(loc.length + 1)}`
}

const authorName = (a: string) => a.replace(/\s*<[^>]*>\s*$/, '').trim()
const authorKind = (name: string): AuthorKind => (/\b(ai|gpt|chatgpt|claude|gemini|copilot|llama|mistral)\b/i.test(name) ? 'ai' : 'human')

async function exists(p: string) {
  return fs.stat(p).then(() => true, () => false)
}

async function uniquePath(path: string) {
  const m = /^(.*?)(\.[^./]+)?$/.exec(path)!
  let candidate = path
  for (let n = 2; await exists(candidate); n++) candidate = `${m[1]} ${n}${m[2] ?? ''}`
  return candidate
}

function toEntries(spans: Span[], kinds: Map<string, AuthorKind>): AuthorEntry[] {
  const byName = new Map<string, AuthorEntry>()
  for (const [a, b, name] of spans) {
    if (!byName.has(name)) byName.set(name, { name, kind: kinds.get(name) ?? authorKind(name), ranges: [] })
    byName.get(name)!.ranges.push([a, b])
  }
  return [...byName.values()]
}

/** Where a new document goes when `path` is a folder or missing. */
async function targetFor(path: string | null, text: string, locations: string[]): Promise<string> {
  const isDir = !path || path.endsWith('/') || (await fs.stat(path).then((s) => s.isDirectory(), () => false))
  if (!isDir) return path
  const dir = (path ?? locations[0]).replace(/\/$/, '')
  return uniquePath(join(dir, fileNameFromTitle(extractTitle(text, 'Untitled')) + '.' + getSettings().defaultExtension))
}

interface WriteOptions {
  mode: string
  text: string
  author?: string
  addLocation?: string
  addPadding?: string
}

/** The write command's file logic; returns the path written and the new text. */
export async function writeDocument(path: string, o: WriteOptions): Promise<{ path: string; text: string }> {
  const existing = (await exists(path)) ? await fs.readFile(path, 'utf8') : null
  const parsed = existing !== null ? await parseAuthorship(existing) : { body: '', entries: [], stale: false }
  const kinds = new Map(parsed.entries.map((e) => [e.name, e.kind]))
  let spans: Span[] = parsed.entries.flatMap((e) => e.ranges.map(([a, b]) => [a, b, e.name] as Span))
  const author = o.author ? authorName(o.author) : ''
  let target = path
  let body: string

  switch (o.mode) {
    case 'replace':
      body = o.text
      spans = author ? [[0, body.length, author]] : []
      break
    case 'add':
    case 'append': {
      const pad = o.addPadding === 'sentence' ? ' ' : o.addPadding === 'paragraph' ? '\n\n' : '\n'
      const base = parsed.body.replace(/\n+$/, '')
      if (!base) {
        body = o.text
        spans = author ? [[0, body.length, author]] : []
      } else if (o.addLocation === 'beginning') {
        const added = o.text + pad
        body = added + parsed.body
        spans = spans.map(([a, b, w]) => [a + added.length, b + added.length, w] as Span)
        if (author) spans.unshift([0, o.text.length, author])
      } else {
        const at = base.length + pad.length
        body = base + pad + o.text + '\n'
        if (author) spans.push([at, at + o.text.length, author])
      }
      break
    }
    case 'patch': {
      const plan = planEdits(parsed.body, o.text)
      body = o.text
      spans = mapSpans(spans, plan.changes)
      if (author) spans.push(...plan.inserted.map(([a, b]) => [a, b, author] as Span))
      break
    }
    default:
      // create: never replace an existing file.
      if (existing !== null) target = await uniquePath(path)
      body = o.text
      spans = author ? [[0, body.length, author]] : []
  }
  if (author && !kinds.has(author)) kinds.set(author, authorKind(author))
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(target, await writeAuthorship(body, toEntries(spans.filter(([a, b]) => b > a), kinds)))
  return { path: target, text: body }
}

function callback(base: string | null, params: Record<string, string>) {
  if (!base) return
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  shell.openExternal(url.toString())
}

export async function handleUrl(raw: string, host: UrlHost) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if (url.protocol !== SCHEME + ':') return
  const p = url.searchParams
  const isCallback = url.hostname === 'x-callback-url'
  const command = isCallback ? url.pathname.replace(/^\//, '') : url.hostname
  const success = p.get('x-success')
  const fail = (message: string) => (p.get('x-error') ? callback(p.get('x-error'), { errorCode: '1', errorMessage: message }) : console.warn('URL command failed:', message))
  const locations = getSettings().libraryLocations
  const bool = (k: string) => p.get(k) === 'true'
  const needsToken = () => {
    if (p.get('auth-token') === urlToken()) return false
    fail('Missing or wrong auth-token. Find it in Inkstand → Settings → General.')
    return true
  }
  const libPath = (required: boolean) => {
    const v = p.get('path')
    if (!v) return required ? (fail('Missing path.'), undefined) : null
    if (!locations.length) return fail('Add a library location first.'), undefined
    const full = resolveLibraryPath(v, locations)
    if (!full) return fail(`Unknown library path: ${v}`), undefined
    return full
  }

  try {
    switch (command) {
      case 'open': {
        const path = libPath(true)
        if (!path) return
        if ((await exists(path)) && isTextFile(path)) host.open(path, bool('new-window'))
        else host.newDocument(bool('new-window'))
        return callback(success, {})
      }
      case 'new': {
        const text = p.get('text') ?? ''
        const path = libPath(false)
        if (path === undefined) return
        if (!text && !path) {
          host.newDocument(bool('new-window'))
          return callback(success, {})
        }
        const target = await targetFor(path, text, locations)
        if (!isTextFile(target)) return fail('The path must end in a plain text extension such as .md or .txt.')
        const written = await writeDocument(target, { mode: 'create', text, author: p.get('author') ?? undefined })
        host.open(written.path, bool('new-window'))
        return callback(success, {})
      }
      case 'quick-search':
        host.quickSearch(p.get('query') ?? '')
        return callback(success, {})
      case 'read': {
        if (needsToken()) return
        const path = libPath(true)
        if (!path) return
        const { body } = await parseAuthorship(await fs.readFile(path, 'utf8'))
        return callback(success, { path: toLibraryPath(path, locations), text: body })
      }
      case 'write': {
        if (needsToken()) return
        const path = libPath(true)
        if (!path) return
        const target = path.endsWith('/') ? await targetFor(path, p.get('text') ?? '', locations) : path
        if (!isTextFile(target)) return fail('The path must end in a plain text extension such as .md or .txt.')
        const written = await writeDocument(target, {
          mode: p.get('mode') ?? 'create',
          text: p.get('text') ?? '',
          author: p.get('author') ?? undefined,
          addLocation: p.get('add-location') ?? p.get('append-location') ?? undefined,
          addPadding: p.get('add-padding') ?? p.get('append-padding') ?? undefined
        })
        return callback(success, { path: toLibraryPath(written.path, locations), text: written.text })
      }
      case 'version':
        return callback(success, { 'scheme-version': SCHEME_VERSION, 'app-version': app.getVersion() })
      default:
        fail(`Unknown command: ${command}`)
    }
  } catch (e: any) {
    fail(e?.message ?? String(e))
  }
}

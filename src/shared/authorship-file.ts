// Authorship stored inside a document, as a trailing HTML comment that Markdown renderers hide:
//
//   <!-- Authorship · FOSS Write
//   sha256: <hash of the text above the block>
//   @ChatGPT [ai]: 120-300, 512-540
//   @Quote [reference]: 400-450
//   -->
//
// Ranges are UTF-16 offsets into the text. Text not listed was written by the document's owner.
// The hash detects edits made by other apps, after which the ranges can't be trusted.
import type { AuthorKind } from './types'
import { splitAuthorship } from './text'

export interface AuthorEntry {
  name: string
  kind: AuthorKind
  ranges: [number, number][]
}

export interface ParsedAuthorship {
  body: string
  entries: AuthorEntry[]
  /** True when a block exists but the text changed since it was written. */
  stale: boolean
}

const KINDS: AuthorKind[] = ['human', 'ai', 'reference']

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function parseAuthorship(text: string): Promise<ParsedAuthorship> {
  const { body, block } = splitAuthorship(text)
  if (block === null) return { body: text, entries: [], stale: false }
  const hash = /^sha256:\s*([0-9a-f]+)/m.exec(block)?.[1]
  const entries: AuthorEntry[] = []
  for (const m of block.matchAll(/^@(.+?)(?:\s+\[(\w+)\])?:\s*(.*)$/gm)) {
    const ranges = [...m[3].matchAll(/(\d+)-(\d+)/g)].map((r) => [Number(r[1]), Number(r[2])] as [number, number]).filter(([a, b]) => b > a && b <= body.length)
    const kind = KINDS.includes(m[2] as AuthorKind) ? (m[2] as AuthorKind) : 'reference'
    if (ranges.length) entries.push({ name: m[1].trim(), kind, ranges })
  }
  const stale = !hash || hash !== (await sha256(body))
  return { body, entries: stale ? [] : entries, stale }
}

/** The text to write to disk: the body, plus a block when anything is attributed to someone else. */
export async function writeAuthorship(body: string, entries: AuthorEntry[]): Promise<string> {
  const used = entries.filter((e) => e.ranges.length)
  if (!used.length) return body
  const clean = body.endsWith('\n') ? body : body + '\n'
  const lines = used.map((e) => `@${e.name.replace(/[:\n]/g, ' ')} [${e.kind}]: ${e.ranges.map(([a, b]) => `${a}-${b}`).join(', ')}`)
  return `${clean}\n<!-- Authorship · FOSS Write\nsha256: ${await sha256(clean)}\n${lines.join('\n')}\n-->\n`
}

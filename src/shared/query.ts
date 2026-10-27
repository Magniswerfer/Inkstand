// Library search language (compatible with iA Writer's):
//
//   text machine        words beginning with text* and machine*
//   "text* machine"     a phrase; words are exact unless they end in *
//   #priority  "#diary" a hashtag beginning with / equal to
//   -#                  no hashtag at all          #  any hashtag
//   [ ]  [x]            an open / completed task
//   .png  ".m"          extension beginning with / equal to
//   ^first              name or text starts with first*
//   name:alice  name:^"note"   only the file name
//   a AND b, a OR b, a NOT b, -a, (a OR b) c
//   NEAR(time space)  NEAR(time "space" travel 4)   within N (default 10) words
import { extractTags } from './text'

export type Node =
  | { t: 'and' | 'or'; a: Node; b: Node }
  | { t: 'not'; a: Node }
  | { t: 'word'; v: string; exact: boolean; field?: 'name'; first?: boolean }
  | { t: 'phrase'; v: string[]; field?: 'name'; first?: boolean }
  | { t: 'tag'; v: string; exact: boolean }
  | { t: 'anyTag' }
  | { t: 'task'; done: boolean }
  | { t: 'ext'; v: string; exact: boolean }
  | { t: 'near'; terms: { v: string; exact: boolean }[]; distance: number }
  | { t: 'all' }

export interface QueryDoc {
  name: string
  text: string
}

const WORD = /[\p{L}\p{N}_]+(?:['’][\p{L}]+)*/gu
export const words = (s: string) => (s.toLowerCase().match(WORD) ?? []) as string[]

function tokenize(q: string): string[] {
  const out: string[] = []
  const re = /\s*(\(|\)|-?"[^"]*"\*?|\[[ xX]\]|NEAR\(|name:\^?"[^"]*"|[^\s()]+)/gy
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) out.push(m[1])
  return out
}

export function parseQuery(q: string): Node {
  const toks = tokenize(q.trim())
  let i = 0
  const peek = () => toks[i]

  function atom(tok: string): Node {
    let field: 'name' | undefined
    let first = false
    if (tok.startsWith('name:')) {
      field = 'name'
      tok = tok.slice(5)
    }
    if (tok.startsWith('^')) {
      first = true
      tok = tok.slice(1)
    }
    if (/^\[[ ]\]$/.test(tok)) return { t: 'task', done: false }
    if (/^\[[xX]\]$/.test(tok)) return { t: 'task', done: true }
    if (tok.startsWith('"')) {
      const inner = tok.replace(/^"|"\*?$/g, '')
      if (inner.startsWith('#')) return { t: 'tag', v: inner.slice(1).toLowerCase(), exact: true }
      if (inner.startsWith('.') && !inner.includes(' ')) return { t: 'ext', v: inner.slice(1).toLowerCase(), exact: true }
      const parts = inner.toLowerCase().split(/\s+/).filter(Boolean)
      if (parts.length === 1) return { t: 'word', v: parts[0].replace(/\*$/, ''), exact: !parts[0].endsWith('*'), field, first }
      return { t: 'phrase', v: parts, field, first }
    }
    if (tok === '#') return { t: 'anyTag' }
    if (tok.startsWith('#')) return { t: 'tag', v: tok.slice(1).toLowerCase(), exact: false }
    if (/^\.[\p{L}\p{N}]+$/u.test(tok)) return { t: 'ext', v: tok.slice(1).toLowerCase(), exact: false }
    const v = tok.toLowerCase().replace(/\*$/, '')
    return { t: 'word', v, exact: false, field, first }
  }

  function near(): Node {
    const terms: { v: string; exact: boolean }[] = []
    let distance = 10
    while (i < toks.length && peek() !== ')') {
      const tok = toks[i++]
      if (/^\d+$/.test(tok)) distance = Number(tok) - 1
      else if (tok.startsWith('"')) terms.push({ v: tok.replace(/^"|"$/g, '').toLowerCase(), exact: true })
      else terms.push({ v: tok.toLowerCase().replace(/\*$/, ''), exact: false })
    }
    i++
    return { t: 'near', terms, distance }
  }

  function unary(): Node | null {
    const tok = toks[i]
    if (tok === undefined || tok === ')') return null
    i++
    if (tok === '(') {
      const e = or()
      if (peek() === ')') i++
      return e
    }
    if (tok === 'NEAR(') return near()
    if (tok.startsWith('-') && tok.length > 1) {
      i--
      toks[i] = tok.slice(1)
      return { t: 'not', a: unary() ?? { t: 'all' } }
    }
    return atom(tok)
  }

  function and(): Node | null {
    let left = unary()
    while (left && i < toks.length && peek() !== ')' && peek() !== 'OR') {
      if (peek() === 'AND') i++
      if (peek() === 'NOT') {
        i++
        const r = unary()
        if (r) left = { t: 'and', a: left, b: { t: 'not', a: r } }
        continue
      }
      const r = unary()
      if (!r) break
      left = { t: 'and', a: left, b: r }
    }
    return left
  }

  function or(): Node {
    let left = and() ?? { t: 'all' }
    while (peek() === 'OR') {
      i++
      const r = and()
      if (r) left = { t: 'or', a: left, b: r }
    }
    return left
  }

  return toks.length ? or() : { t: 'all' }
}

interface Prepared {
  name: string
  base: string
  ext: string
  nameWords: string[]
  textWords: string[]
  tags: string[]
  text: string
}

function prepare(doc: QueryDoc): Prepared {
  const dot = doc.name.lastIndexOf('.')
  const base = dot > 0 ? doc.name.slice(0, dot) : doc.name
  return {
    name: doc.name,
    base,
    ext: dot > 0 ? doc.name.slice(dot + 1).toLowerCase() : '',
    nameWords: words(base),
    textWords: words(doc.text),
    tags: extractTags(doc.text),
    text: doc.text
  }
}

const hit = (w: string, v: string, exact: boolean) => (exact ? w === v : w.startsWith(v))

function phraseAt(list: string[], parts: string[], start: number) {
  return parts.every((p, k) => {
    const w = list[start + k]
    return w !== undefined && (p.endsWith('*') ? w.startsWith(p.slice(0, -1)) : w === p)
  })
}

function evaluate(n: Node, d: Prepared): boolean {
  switch (n.t) {
    case 'all':
      return true
    case 'and':
      return evaluate(n.a, d) && evaluate(n.b, d)
    case 'or':
      return evaluate(n.a, d) || evaluate(n.b, d)
    case 'not':
      return !evaluate(n.a, d)
    case 'word': {
      const lists = n.field === 'name' ? [d.nameWords] : [d.nameWords, d.textWords]
      return lists.some((l) => (n.first ? l.length > 0 && hit(l[0], n.v, n.exact) : l.some((w) => hit(w, n.v, n.exact))))
    }
    case 'phrase': {
      const lists = n.field === 'name' ? [d.nameWords] : [d.nameWords, d.textWords]
      return lists.some((l) => (n.first ? phraseAt(l, n.v, 0) : l.some((_, k) => phraseAt(l, n.v, k))))
    }
    case 'tag':
      return d.tags.some((t) => (n.exact ? t === n.v : t.startsWith(n.v)))
    case 'anyTag':
      return d.tags.length > 0
    case 'task':
      return n.done ? /^\s*[-*+]\s+\[[xX]\]/m.test(d.text) : /^\s*[-*+]\s+\[ \]/m.test(d.text)
    case 'ext':
      return n.exact ? d.ext === n.v : d.ext.startsWith(n.v)
    case 'near': {
      const pos = n.terms.map((t) => d.textWords.flatMap((w, k) => (hit(w, t.v, t.exact) ? [k] : [])))
      if (pos.some((p) => !p.length)) return false
      // Every term must occur inside some window of (terms + distance) words.
      const span = n.terms.length + n.distance
      return pos[0].some((start) => pos.every((p) => p.some((k) => Math.abs(k - start) < span)))
    }
  }
}

export function matchQuery(node: Node, doc: QueryDoc): boolean {
  return evaluate(node, prepare(doc))
}

/** Terms worth highlighting in a result snippet. */
export function queryTerms(node: Node): string[] {
  switch (node.t) {
    case 'and':
    case 'or':
      return [...queryTerms(node.a), ...queryTerms(node.b)]
    case 'word':
      return [node.v]
    case 'phrase':
      return [node.v.join(' ').replace(/\*/g, '')]
    case 'tag':
      return ['#' + node.v]
    case 'near':
      return node.terms.map((t) => t.v)
    default:
      return []
  }
}

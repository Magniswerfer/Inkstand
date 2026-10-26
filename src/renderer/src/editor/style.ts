import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Settings } from '@shared/types'
import { CLICHES, FILLERS, parseList, REDUNDANCIES, type PhraseEntry } from './style-data'
import { isCodeAt } from './util'

export type IssueKind = 'filler' | 'cliche' | 'redundancy' | 'custom'

export interface StyleIssue {
  from: number
  to: number
  kind: IssueKind
  text: string
  suggestion?: string
  note?: string
}

interface Matcher {
  kind: IssueKind
  re: RegExp
  entries: Map<string, PhraseEntry & { note?: string }>
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phraseSource = (p: string) => escape(p).replace(/\s+/g, '\\s+').replace(/'/g, "['’]")
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/’/g, "'")

function phraseMatcher(kind: IssueKind, list: PhraseEntry[]): Matcher | null {
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => b.phrase.length - a.phrase.length)
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${sorted.map((e) => phraseSource(e.phrase)).join('|')})(?![\\p{L}\\p{N}-])`, 'giu')
  return { kind, re, entries: new Map(list.map((e) => [norm(e.phrase), e])) }
}

const lists = {
  fillers: parseList(FILLERS),
  cliches: parseList(CLICHES),
  redundancies: parseList(REDUNDANCIES)
}

export function buildMatchers(cfg: Settings['styleCheck']): Matcher[] {
  const out: Matcher[] = []
  if (cfg.fillers) out.push(phraseMatcher('filler', lists.fillers)!)
  if (cfg.cliches) out.push(phraseMatcher('cliche', lists.cliches)!)
  if (cfg.redundancies) out.push(phraseMatcher('redundancy', lists.redundancies)!)
  for (const c of cfg.custom) {
    if (!c.enabled || !c.pattern.trim()) continue
    try {
      const src = c.isRegex ? c.pattern : `(?<![\\p{L}\\p{N}])${phraseSource(c.pattern)}(?![\\p{L}\\p{N}])`
      out.push({ kind: 'custom', re: new RegExp(src, c.caseSensitive ? 'gu' : 'giu'), entries: new Map([['*', { phrase: c.pattern, note: c.note }]]) })
    } catch {
      // Invalid regex: the settings panel flags it.
    }
  }
  return out
}

export function findIssues(text: string, matchers: Matcher[], ignored: Set<string>, offset = 0): StyleIssue[] {
  const issues: StyleIssue[] = []
  for (const m of matchers) {
    m.re.lastIndex = 0
    for (const match of text.matchAll(m.re)) {
      if (!match[0]) continue
      const key = norm(match[0])
      if (ignored.has(key)) continue
      const entry = m.entries.get(key) ?? m.entries.get('*')
      issues.push({ from: offset + match.index!, to: offset + match.index! + match[0].length, kind: m.kind, text: match[0], suggestion: entry?.suggestion, note: entry?.note })
    }
  }
  issues.sort((a, b) => a.from - b.from || b.to - a.to)
  // Drop overlaps so each word carries at most one underline.
  const out: StyleIssue[] = []
  for (const i of issues) if (!out.length || i.from >= out[out.length - 1].to) out.push(i)
  return out
}

const LABEL: Record<IssueKind, string> = { filler: 'Filler', cliche: 'Cliché', redundancy: 'Redundancy', custom: 'Custom pattern' }
const marks = Object.fromEntries((Object.keys(LABEL) as IssueKind[]).map((k) => [k, Decoration.mark({ class: `cm-fw-style cm-fw-style-${k}` })]))

function issuesInView(view: EditorView, matchers: Matcher[], ignored: Set<string>) {
  const all: StyleIssue[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      if (!isCodeAt(view.state, line.from)) {
        for (const i of findIssues(line.text, matchers, ignored, line.from)) if (!isCodeAt(view.state, i.from)) all.push(i)
      }
      pos = line.to + 1
    }
  }
  return all
}

export function styleCheck(cfg: Settings['styleCheck'], onIgnore: (phrase: string) => void): Extension {
  const matchers = buildMatchers(cfg)
  if (!matchers.length) return []
  const ignored = new Set(cfg.ignored.map(norm))
  let current: StyleIssue[] = []

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view)
      }
      build(view: EditorView) {
        current = issuesInView(view, matchers, ignored)
        const b = new RangeSetBuilder<Decoration>()
        for (const i of current) b.add(i.from, i.to, marks[i.kind])
        return b.finish()
      }
    },
    { decorations: (v) => v.decorations }
  )

  const tooltip = hoverTooltip((view, pos) => {
    const issue = current.find((i) => pos >= i.from && pos <= i.to)
    if (!issue) return null
    return {
      pos: issue.from,
      end: issue.to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-fw-style-tip'
        const title = document.createElement('strong')
        title.textContent = LABEL[issue.kind]
        dom.append(title)
        const body = document.createElement('div')
        body.textContent = issue.note || (issue.suggestion ? `Consider “${issue.suggestion}”.` : issue.kind === 'filler' ? 'Can you cut it?' : 'Try saying it in your own words.')
        dom.append(body)
        const actions = document.createElement('div')
        actions.className = 'cm-fw-style-actions'
        if (issue.suggestion) {
          const replace = document.createElement('button')
          replace.textContent = 'Replace'
          replace.onclick = () => view.dispatch({ changes: { from: issue.from, to: issue.to, insert: issue.suggestion! } })
          actions.append(replace)
        }
        const ignore = document.createElement('button')
        ignore.textContent = 'Ignore'
        ignore.onclick = () => onIgnore(norm(issue.text))
        actions.append(ignore)
        dom.append(actions)
        return { dom }
      }
    }
  })

  return [plugin, tooltip]
}

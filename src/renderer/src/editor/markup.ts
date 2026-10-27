// Markdown presentation: dimmed or hidden markup, hanging heading marks, hashtags, wiki links,
// ==highlights==, content blocks and front matter.
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { MarkupMode } from '@shared/types'
import { TAG_RE } from '@shared/text'
import { isCodeAt } from './util'
import { textWidth } from './measure'

const markDeco = Decoration.mark({ class: 'cm-fw-mark' })
const hide = Decoration.replace({})
const tagDeco = Decoration.mark({ class: 'cm-fw-tag' })
const wikiDeco = Decoration.mark({ class: 'cm-fw-wikilink' })
const highlightDeco = Decoration.mark({ class: 'cm-fw-highlight' })
const blockDeco = Decoration.line({ class: 'cm-fw-block', attributes: { spellcheck: 'false' } })
const noSpellDeco = Decoration.mark({ class: 'cm-fw-mark', attributes: { spellcheck: 'false' } })
const frontMatterDeco = Decoration.line({ class: 'cm-fw-frontmatter' })
/** Heading marks are bold only when markup is shown in the text colour. */
const headingLine = (level: number, marks: string, bold: boolean) =>
  Decoration.line({ class: `cm-fw-heading cm-fw-h${level}`, attributes: { style: `text-indent: -${textWidth(marks, bold)}px` } })
/** Wrapped lines of list items and quotes line up with the text, not the marker. */
const hangingLine = (prefix: string) => {
  const w = textWidth(prefix)
  return Decoration.line({ attributes: { style: `padding-left: ${w}px; text-indent: -${w}px` } })
}
const LIST_PREFIX = /^(\s*([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?|\s*(>[ \t]?)+)/

const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'QuoteMark', 'ListMark', 'TaskMarker', 'HeaderMark', 'TableDelimiter'])
const HIDEABLE = new Set(['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'HeaderMark'])

export const CONTENT_BLOCK_RE = /^\s{0,3}(\/\S.*?|https?:\/\/\S+\.(?:png|jpe?g|gif|svg|webp|avif))(\s+"[^"]*")?\s*$/i
export const WIKI_RE = /\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g

export function frontMatterEnd(state: EditorState): number {
  const doc = state.doc
  if (doc.lines < 2 || !/^---\s*$/.test(doc.line(1).text)) return -1
  for (let i = 2; i <= Math.min(doc.lines, 200); i++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return i
  }
  return -1
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    for (let i = a; i <= b; i++) lines.add(i)
  }
  return lines
}

function build(view: EditorView, mode: MarkupMode, hanging: boolean): DecorationSet {
  const { state } = view
  const decos: Range<Decoration>[] = []
  const active = mode === 'hide' && view.hasFocus ? activeLines(state) : mode === 'hide' ? new Set<number>() : null
  const fmEnd = frontMatterEnd(state)

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (name === 'Document') return
        const lineNo = state.doc.lineAt(node.from).number
        if (fmEnd > 0 && lineNo <= fmEnd) return false
        if (/^ATXHeading\d$/.test(name)) {
          const level = Number(name.slice(-1))
          const line = state.doc.lineAt(node.from)
          const m = /^#{1,6}\s?/.exec(line.text)
          if (m) {
            if (hanging && !(active && !active.has(line.number))) decos.push(headingLine(level, m[0], mode === 'show').range(line.from))
            else decos.push(Decoration.line({ class: `cm-fw-heading cm-fw-h${level}` }).range(line.from))
          }
          return
        }
        if (/^SetextHeading\d$/.test(name)) {
          decos.push(Decoration.line({ class: `cm-fw-heading cm-fw-h${name.slice(-1)}` }).range(state.doc.lineAt(node.from).from))
          return
        }
        if (!INLINE_MARKS.has(name)) {
          if (name === 'URL' && node.node.parent?.name === 'Link' && active && !active.has(lineNo)) {
            decos.push(hide.range(node.from, node.to))
          } else if (name === 'URL' || name === 'LinkTitle' || name === 'CodeInfo') {
            if (node.to > node.from) decos.push(noSpellDeco.range(node.from, node.to))
          }
          return
        }
        if (node.to <= node.from) return
        const hideIt = active && !active.has(lineNo) && HIDEABLE.has(name) && node.node.parent?.name !== 'Image'
        if (hideIt) {
          // Hide "# " together with its trailing space.
          const end = name === 'HeaderMark' && state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decos.push(hide.range(node.from, end))
        } else if (name === 'HeaderMark') {
          const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decos.push(Decoration.mark({ class: 'cm-fw-mark cm-fw-hmark' }).range(node.from, end))
        } else decos.push(markDeco.range(node.from, node.to))
      }
    })

    // Things the Markdown grammar doesn't know about.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      pos = line.to + 1
      if (fmEnd > 0 && line.number <= fmEnd) {
        decos.push(frontMatterDeco.range(line.from))
        continue
      }
      if (isCodeAt(state, line.from) && !/^\s*\//.test(line.text)) continue
      if (CONTENT_BLOCK_RE.test(line.text) && !isCodeAt(state, line.from)) decos.push(blockDeco.range(line.from))
      const prefix = LIST_PREFIX.exec(line.text)
      if (prefix && prefix[0].length < line.text.length && !isCodeAt(state, line.from + prefix[0].length)) decos.push(hangingLine(prefix[0]).range(line.from))
      for (const m of line.text.matchAll(TAG_RE)) {
        const at = line.from + m.index!
        if (/^#{1,6}\s/.test(line.text) && m.index === 0) continue
        if (!isCodeAt(state, at)) decos.push(tagDeco.range(at, at + m[0].length))
      }
      for (const m of line.text.matchAll(WIKI_RE)) {
        const at = line.from + m.index!
        if (isCodeAt(state, at)) continue
        const end = at + m[0].length
        if (active && !active.has(line.number)) {
          decos.push(hide.range(at, at + 2))
          if (m[2]) decos.push(hide.range(at + 2, at + 2 + m[1].length + 1))
          decos.push(wikiDeco.range(m[2] ? at + 2 + m[1].length + 1 : at + 2, end - 2))
          decos.push(hide.range(end - 2, end))
        } else {
          decos.push(markDeco.range(at, at + 2), wikiDeco.range(at + 2, end - 2), markDeco.range(end - 2, end))
        }
      }
      for (const m of line.text.matchAll(/(?<![=\\])==(?=\S)([^=\n]+?)(?<=\S)==(?!=)/g)) {
        const at = line.from + m.index!
        if (isCodeAt(state, at)) continue
        const end = at + m[0].length
        decos.push(markDeco.range(at, at + 2), highlightDeco.range(at + 2, end - 2), markDeco.range(end - 2, end))
      }
    }
  }
  return Decoration.set(decos, true)
}

export function markup(mode: MarkupMode, hanging: boolean): Extension {
  return [
    EditorView.editorAttributes.of({ class: `cm-fw-markup-${mode}${hanging ? ' cm-fw-hanging' : ''}` }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = build(view, mode, hanging)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || u.focusChanged || (mode === 'hide' && u.selectionSet) || syntaxTree(u.startState) !== syntaxTree(u.state)) {
            this.decorations = build(u.view, mode, hanging)
          }
        }
      },
      { decorations: (v) => v.decorations }
    )
  ]
}

export interface LinkTarget {
  kind: 'url' | 'wiki' | 'tag' | 'block' | 'footnote'
  target: string
}

/** What's under the pointer, for Cmd/Ctrl-click navigation. */
export function linkAt(state: EditorState, pos: number): LinkTarget | null {
  const line = state.doc.lineAt(pos)
  const col = pos - line.from
  for (const m of line.text.matchAll(WIKI_RE)) {
    if (col >= m.index! && col <= m.index! + m[0].length) return { kind: 'wiki', target: m[1].trim() }
  }
  for (const m of line.text.matchAll(TAG_RE)) {
    if (col >= m.index! && col <= m.index! + m[0].length) return { kind: 'tag', target: m[1] }
  }
  const block = CONTENT_BLOCK_RE.exec(line.text)
  if (block) return { kind: 'block', target: block[1] }
  for (let node: any = syntaxTree(state).resolveInner(pos, 0); node; node = node.parent) {
    if (node.name === 'URL') return { kind: 'url', target: state.sliceDoc(node.from, node.to).replace(/^<|>$/g, '') }
    if (node.name === 'Link' || node.name === 'Image') {
      const url = node.getChild('URL')
      if (url) return { kind: 'url', target: state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '') }
      // Reference links: [text][ref] or [ref]
      const text = state.sliceDoc(node.from, node.to)
      const ref = /\]\[([^\]]+)\]$/.exec(text)?.[1] ?? /^\[([^\]]+)\]$/.exec(text)?.[1]
      if (ref?.startsWith('^')) return { kind: 'footnote', target: ref }
      if (ref) {
        const def = new RegExp(`^\\s*\\[${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*(\\S+)`, 'im').exec(state.doc.toString())
        if (def) return { kind: 'url', target: def[1].replace(/^<|>$/g, '') }
      }
    }
  }
  const fn = /\[\^([^\]]+)\]/g
  for (const m of line.text.matchAll(fn)) {
    if (col >= m.index! && col <= m.index! + m[0].length) return { kind: 'footnote', target: '^' + m[1] }
  }
  const bare = /https?:\/\/[^\s<>()]+/g
  for (const m of line.text.matchAll(bare)) {
    if (col >= m.index! && col <= m.index! + m[0].length) return { kind: 'url', target: m[0] }
  }
  return null
}

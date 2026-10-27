// Authorship: remembers who wrote each part of the text. Text you type is yours; pasted text is
// credited to the paste author (a person, an AI tool or a reference); Mark As and Paste Edits
// From credit it explicitly.
import { StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { Author, Span } from '@shared/types'

export type { Span }

export const setSpans = StateEffect.define<Span[]>()
/** Credits [from, to) to an author; '' means you. */
export const markAs = StateEffect.define<{ from: number; to: number; author: string }>()

/** Who pasted text is credited to; '' turns paste tracking off. Set from settings. */
let pasteAuthor = 'pasted'
export function setPasteAuthor(id: string) {
  pasteAuthor = id
}

export function subtract(spans: Span[], from: number, to: number): Span[] {
  const out: Span[] = []
  for (const [a, b, who] of spans) {
    if (b <= from || a >= to) out.push([a, b, who])
    else {
      if (a < from) out.push([a, from, who])
      if (b > to) out.push([to, b, who])
    }
  }
  return out
}

function add(spans: Span[], from: number, to: number, who: string): Span[] {
  const rest = subtract(spans, from, to)
  return who ? [...rest, [from, to, who]] : rest
}

/** Sorted, non-empty, with touching runs by the same author merged. */
function normalize(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && last[2] === s[2] && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else out.push([s[0], s[1], s[2]])
  }
  return out
}

function apply(spans: Span[], tr: Transaction): Span[] {
  let next = spans
  if (tr.docChanged) {
    next = spans.map(([a, b, who]) => [tr.changes.mapPos(a, 1), tr.changes.mapPos(b, -1), who] as Span)
    const pasted = tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')
    const typed = tr.isUserEvent('input') && !pasted
    if (pasted || typed) {
      tr.changes.iterChanges((_fa, _ta, fromB, toB) => {
        if (toB > fromB) next = pasted ? add(next, fromB, toB, pasteAuthor) : subtract(next, fromB, toB)
      })
    }
  }
  for (const e of tr.effects) {
    if (e.is(setSpans)) next = e.value
    if (e.is(markAs)) next = add(next, e.value.from, e.value.to, e.value.author)
  }
  return next === spans ? spans : normalize(next)
}

export const authorshipField = StateField.define<Span[]>({
  create: () => [],
  update: (value, tr) => apply(value, tr)
})

/** Colours each author's text in their colour. */
export function authorshipDisplay(show: boolean, authors: Author[]): Extension {
  if (!show) return []
  const marks = new Map(
    authors.map((a) => [a.id, Decoration.mark({ class: `cm-fw-authored cm-fw-authored-${a.kind}`, attributes: { style: `--fw-author: ${a.color}` } })])
  )
  const fallback = Decoration.mark({ class: 'cm-fw-authored', attributes: { style: '--fw-author: var(--borrowed)' } })
  return EditorView.decorations.compute([authorshipField], (state) => {
    const len = state.doc.length
    return Decoration.set(
      state
        .field(authorshipField)
        .filter(([a, b]) => b > a && a < len)
        .map(([a, b, who]) => (marks.get(who) ?? fallback).range(a, Math.min(b, len)))
    ) as DecorationSet
  })
}

/** Characters credited to each author (not including you). */
export function authorShares(spans: Span[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [a, b, who] of spans) out.set(who, (out.get(who) ?? 0) + (b - a))
  return out
}

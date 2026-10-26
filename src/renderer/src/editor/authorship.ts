// Authorship: remembers which text was pasted (borrowed: quotes, AI output, other writers)
// and which you typed yourself. Typing over borrowed text makes it yours.
import { StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export type Ranges = [number, number][]

export const setBorrowed = StateEffect.define<Ranges>()
export const markBorrowed = StateEffect.define<{ from: number; to: number; borrowed: boolean }>()

function normalize(ranges: Ranges): Ranges {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Ranges = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export function subtract(ranges: Ranges, from: number, to: number): Ranges {
  const out: Ranges = []
  for (const [a, b] of ranges) {
    if (b <= from || a >= to) out.push([a, b])
    else {
      if (a < from) out.push([a, from])
      if (b > to) out.push([to, b])
    }
  }
  return out
}

function apply(ranges: Ranges, tr: Transaction): Ranges {
  let next = ranges
  if (tr.docChanged) {
    next = ranges.map(([a, b]) => [tr.changes.mapPos(a, 1), tr.changes.mapPos(b, -1)] as [number, number])
    const pasted = tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')
    const typed = tr.isUserEvent('input') && !pasted
    if (pasted || typed) {
      tr.changes.iterChanges((_fa, _ta, fromB, toB) => {
        if (toB <= fromB) return
        next = pasted ? [...next, [fromB, toB]] : subtract(next, fromB, toB)
      })
    }
  }
  for (const e of tr.effects) {
    if (e.is(setBorrowed)) next = e.value
    if (e.is(markBorrowed)) next = e.value.borrowed ? [...next, [e.value.from, e.value.to]] : subtract(next, e.value.from, e.value.to)
  }
  return next === ranges ? ranges : normalize(next)
}

export const authorshipField = StateField.define<Ranges>({
  create: () => [],
  update: (value, tr) => apply(value, tr)
})

const borrowedMark = Decoration.mark({ class: 'cm-fw-borrowed' })

export function authorshipDisplay(show: boolean): Extension {
  if (!show) return []
  return EditorView.decorations.compute([authorshipField], (state) => {
    const len = state.doc.length
    return Decoration.set(
      state
        .field(authorshipField)
        .filter(([a, b]) => b > a && a < len)
        .map(([a, b]) => borrowedMark.range(a, Math.min(b, len)))
    ) as DecorationSet
  })
}

export function borrowedShare(ranges: Ranges, length: number): number {
  if (!length) return 0
  return ranges.reduce((n, [a, b]) => n + (b - a), 0) / length
}

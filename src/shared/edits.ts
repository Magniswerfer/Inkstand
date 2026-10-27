// Turning one version of a text into another with minimal word-level edits, so only the words
// that changed can be credited to whoever changed them.
import { diffWordsWithSpace } from 'diff'
import type { Span } from './types'

export interface Edit {
  changes: { from: number; to: number; insert: string }[]
  /** Inserted ranges, in the coordinates of the edited text. */
  inserted: [number, number][]
}

/** Word-level edits that turn `before` into `after`, with offsets relative to `before`. */
export function planEdits(before: string, after: string): Edit {
  const changes: Edit['changes'] = []
  const inserted: [number, number][] = []
  let oldPos = 0
  let newPos = 0
  for (const part of diffWordsWithSpace(before, after)) {
    const len = part.value.length
    if (part.removed) {
      const last = changes[changes.length - 1]
      if (last && last.to === oldPos && !last.insert) last.to += len
      else changes.push({ from: oldPos, to: oldPos + len, insert: '' })
      oldPos += len
    } else if (part.added) {
      const last = changes[changes.length - 1]
      if (last && last.to === oldPos) last.insert += part.value
      else changes.push({ from: oldPos, to: oldPos, insert: part.value })
      inserted.push([newPos, newPos + len])
      newPos += len
    } else {
      oldPos += len
      newPos += len
    }
  }
  return { changes, inserted }
}

/** Moves authorship spans through a set of edits (offsets relative to the old text). */
export function mapSpans(spans: Span[], changes: Edit['changes']): Span[] {
  const map = (pos: number, assoc: 1 | -1) => {
    let delta = 0
    for (const c of changes) {
      if (c.to <= pos && !(c.to === pos && c.from === pos && assoc < 0)) delta += c.insert.length - (c.to - c.from)
      else if (c.from < pos) return c.from + delta + (assoc > 0 ? c.insert.length : 0)
    }
    return pos + delta
  }
  return spans.map(([a, b, who]) => [map(a, 1), map(b, -1), who] as Span).filter(([a, b]) => b > a)
}

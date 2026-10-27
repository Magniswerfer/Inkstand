// Paste Edits From: apply a revised version of the text (say, from an AI tool) as minimal edits,
// crediting only the words that changed to that author.
import { diffWordsWithSpace } from 'diff'
import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { markAs } from './authorship'

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

export function pasteEdits(view: EditorView, revised: string, authorId: string) {
  const { state } = view
  const sel = state.selection.main
  const from = sel.empty ? 0 : sel.from
  const to = sel.empty ? state.doc.length : sel.to
  const { changes, inserted } = planEdits(state.sliceDoc(from, to), revised)
  if (!changes.length) return
  const specs: ChangeSpec[] = changes.map((c) => ({ from: c.from + from, to: c.to + from, insert: c.insert }))
  view.dispatch({
    changes: specs,
    effects: inserted.map(([a, b]) => markAs.of({ from: a + from, to: b + from, author: authorId })),
    userEvent: 'input.edits',
    scrollIntoView: true
  })
  view.focus()
}

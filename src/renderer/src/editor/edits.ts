// Paste Edits From: apply a revised version of the text (say, from an AI tool) as minimal edits,
// crediting only the words that changed to that author.
import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { planEdits } from '@shared/edits'
import { markAs } from './authorship'

export { planEdits }

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

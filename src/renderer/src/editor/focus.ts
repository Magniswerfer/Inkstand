// Focus mode dims everything but the current sentence, paragraph or line.
import { type Extension, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { FocusMode } from '@shared/types'
import { paragraphAt } from './util'

const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const dim = Decoration.mark({ class: 'cm-fw-dim' })

export function focusRange(state: EditorState, mode: FocusMode): { from: number; to: number } {
  const head = state.selection.main.head
  if (mode === 'line') {
    const line = state.doc.lineAt(head)
    return { from: line.from, to: line.to }
  }
  const para = paragraphAt(state, head)
  if (mode === 'paragraph') return para
  const text = state.sliceDoc(para.from, para.to)
  const offset = head - para.from
  for (const seg of sentences.segment(text)) {
    const start = seg.index
    const end = start + seg.segment.length
    if (offset >= start && (offset < end || end === text.length)) {
      return { from: para.from + start, to: para.from + start + seg.segment.trimEnd().length }
    }
  }
  return para
}

export function focusMode(mode: FocusMode): Extension {
  if (mode === 'off') return []
  return [
    EditorView.editorAttributes.of({ class: 'cm-fw-focus' }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = this.build(view)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet) this.decorations = this.build(u.view)
        }
        build(view: EditorView) {
          const { from, to } = focusRange(view.state, mode)
          const ranges = []
          if (from > 0) ranges.push(dim.range(0, from))
          if (to < view.state.doc.length) ranges.push(dim.range(to, view.state.doc.length))
          return Decoration.set(ranges)
        }
      },
      { decorations: (v) => v.decorations }
    )
  ]
}

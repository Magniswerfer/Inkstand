// Typewriter mode keeps the line being edited in the vertical centre of the window.
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * scrollIntoView is computed before a freshly inserted line has been laid out, so after Return the
 * caret lands one line low until the next keystroke. On the next frame, once layout has settled,
 * nudge the scroll by the caret's real distance from the centre.
 */
const recentre = ViewPlugin.fromClass(
  class {
    private frame = 0
    constructor(private view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged && !u.selectionSet) return
      if (u.transactions.some((tr) => tr.isUserEvent('select.pointer'))) return
      cancelAnimationFrame(this.frame)
      this.frame = requestAnimationFrame(() =>
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const caret = view.coordsAtPos(view.state.selection.main.head)
            if (!caret) return 0
            const box = view.scrollDOM.getBoundingClientRect()
            return (caret.top + caret.bottom) / 2 - (box.top + box.height / 2)
          },
          write: (delta, view) => {
            if (Math.abs(delta) > 1) view.scrollDOM.scrollTop += delta
          }
        })
      )
    }
    destroy() {
      cancelAnimationFrame(this.frame)
    }
  }
)

export function typewriter(on: boolean): Extension {
  if (!on) return []
  return [
    EditorView.editorAttributes.of({ class: 'cm-fw-typewriter' }),
    EditorState.transactionExtender.of((tr) => {
      if (!tr.docChanged && !tr.selection) return null
      if (tr.isUserEvent('select.pointer')) return null
      return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
    }),
    recentre
  ]
}

// Typewriter mode keeps the line being edited in the vertical centre of the window.
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function typewriter(on: boolean): Extension {
  if (!on) return []
  return [
    EditorView.editorAttributes.of({ class: 'cm-fw-typewriter' }),
    EditorState.transactionExtender.of((tr) => {
      if (!tr.docChanged && !tr.selection) return null
      if (tr.isUserEvent('select.pointer')) return null
      return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
    })
  ]
}

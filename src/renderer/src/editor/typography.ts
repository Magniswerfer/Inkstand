// Smart quotes, dashes and ellipses as you type.
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isCodeAt } from './util'

const OPENERS = /[\s([{<“‘—–\-/]|^$/

export function smartQuote(prev: string, ch: '"' | "'"): string {
  const opening = OPENERS.test(prev)
  if (ch === '"') return opening ? '“' : '”'
  return opening ? '‘' : '’'
}

export function typography(opts: { quotes: boolean; dashes: boolean }): Extension {
  if (!opts.quotes && !opts.dashes) return []
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || view.composing) return false
    const state = view.state
    if (isCodeAt(state, from) || (from > 0 && isCodeAt(state, from - 1))) return false
    const line = state.doc.lineAt(from)
    const before = state.sliceDoc(line.from, from)
    if (opts.quotes && (text === '"' || text === "'")) {
      // Leave front matter and HTML attributes alone.
      if (/<[^>]*$/.test(before)) return false
      view.dispatch({ changes: { from, to, insert: smartQuote(before.slice(-1), text) }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
      return true
    }
    if (opts.dashes && text === '-' && before.endsWith('-')) {
      // "--" becomes an em dash, but "---" at the start of a line stays a rule / front matter fence.
      if (/^\s*-$/.test(before) || /^\s*[-*+]\s*-$/.test(before)) return false
      view.dispatch({ changes: { from: from - 1, to, insert: '—' }, selection: { anchor: from }, userEvent: 'input.type' })
      return true
    }
    if (opts.dashes && text === '-' && /^\s*—$/.test(before)) {
      view.dispatch({ changes: { from: from - 1, to, insert: '---' }, selection: { anchor: from + 2 }, userEvent: 'input.type' })
      return true
    }
    if (opts.dashes && text === '.' && before.endsWith('..')) {
      view.dispatch({ changes: { from: from - 2, to, insert: '…' }, selection: { anchor: from - 1 }, userEvent: 'input.type' })
      return true
    }
    return false
  })
}

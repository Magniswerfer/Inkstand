// Case transformations for the selection (or the word at the caret).
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type CaseMode = 'title' | 'upper' | 'lower' | 'capitalize'

const SMALL = new Set('a an and as at but by en for from if in nor of on or per so the to up via vs yet with'.split(' '))
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu

const cap = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1)
/** Words like "iPhone" or "URL" already have deliberate casing; leave them alone. */
const deliberate = (w: string) => /\p{Lu}/u.test(w.slice(1))

export function titleCase(text: string): string {
  const words = [...text.matchAll(WORD)]
  return text.replace(WORD, (w, offset: number) => {
    const i = words.findIndex((m) => m.index === offset)
    const first = i === 0 || /[:.!?—–]\s*$/.test(text.slice(0, offset))
    const last = i === words.length - 1
    if (deliberate(w)) return w
    const lower = w.toLocaleLowerCase()
    return !first && !last && SMALL.has(lower) ? lower : cap(lower)
  })
}

export function changeCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return text.toLocaleUpperCase()
    case 'lower':
      return text.toLocaleLowerCase()
    case 'capitalize':
      return text.replace(WORD, (w) => (deliberate(w) ? w : cap(w.toLocaleLowerCase())))
    case 'title':
      return titleCase(text)
  }
}

export function transformSelection(view: EditorView, mode: CaseMode) {
  const { state } = view
  view.dispatch(
    state.changeByRange((r0) => {
      const r = r0.empty ? state.wordAt(r0.head) ?? r0 : r0
      const insert = changeCase(state.sliceDoc(r.from, r.to), mode)
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(r.from, r.from + insert.length) }
    }),
    { userEvent: 'input.format' }
  )
  view.focus()
}

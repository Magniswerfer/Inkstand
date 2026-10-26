import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'HTMLBlock', 'Comment', 'CommentBlock', 'URL'])

/** True when pos is inside code, HTML or a URL, where prose tools should stay quiet. */
export function isCodeAt(state: EditorState, pos: number): boolean {
  for (let node: any = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE.has(node.name)) return true
  }
  return false
}

/** Range of the paragraph (run of non-blank lines) around pos. */
export function paragraphAt(state: EditorState, pos: number): { from: number; to: number } {
  const doc = state.doc
  let start = doc.lineAt(pos)
  let end = start
  if (!start.text.trim()) return { from: start.from, to: start.to }
  while (start.number > 1) {
    const prev = doc.line(start.number - 1)
    if (!prev.text.trim()) break
    start = prev
  }
  while (end.number < doc.lines) {
    const next = doc.line(end.number + 1)
    if (!next.text.trim()) break
    end = next
  }
  return { from: start.from, to: end.to }
}

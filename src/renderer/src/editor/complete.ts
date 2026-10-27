// Autocompletion for [[wiki links]], /content blocks and #tags.
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

export interface CompletionSource {
  /** Library documents, for wiki links. */
  documents(): { label: string; detail: string; insert: string }[]
  /** Files relative to the current document's folder, for content blocks. */
  relativeFiles(): Promise<string[]>
  tags(): string[]
}

export function completions(src: CompletionSource): Extension {
  const wiki = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/)
    if (!m) return null
    const close = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]' ? '' : ']]'
    const options = src.documents().map((d) => ({ label: d.label, detail: d.detail, type: 'file', apply: d.insert + close }))
    return { from: m.from + 2, options, validFor: /^[^\]\n]*$/ }
  }

  const block = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = ctx.state.sliceDoc(line.from, ctx.pos)
    if (!/^\s{0,3}\/[^\s"]*$/.test(before)) return null
    const files = await src.relativeFiles()
    const start = line.from + before.indexOf('/') + 1
    return { from: start, options: files.map((f) => ({ label: f, type: /\.(png|jpe?g|gif|svg|webp)$/i.test(f) ? 'image' : 'file' })), validFor: /^[^\s"]*$/ }
  }

  const tag = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?<![\p{L}\p{N}_#&/])#[\p{L}_][\p{L}\p{N}_\-/]*/u)
    if (!m || (m.from === ctx.state.doc.lineAt(ctx.pos).from && /^#+\s/.test(ctx.state.doc.lineAt(ctx.pos).text))) return null
    return { from: m.from + 1, options: src.tags().map((t) => ({ label: t, type: 'keyword' })), validFor: /^[\p{L}\p{N}_\-/]*$/u }
  }

  return autocompletion({ override: [wiki, block, tag], icons: false, activateOnTyping: true, closeOnBlur: true })
}

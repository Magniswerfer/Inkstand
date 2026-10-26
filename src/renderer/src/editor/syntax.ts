// Parts-of-speech highlighting (adjectives, nouns, adverbs, verbs, conjunctions), English only.
import nlp from 'compromise'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Settings } from '@shared/types'
import { isCodeAt } from './util'

type Pos = keyof Settings['syntax']
const ORDER: [string, Pos][] = [
  ['Conjunction', 'conjunctions'],
  ['Adverb', 'adverbs'],
  ['Adjective', 'adjectives'],
  ['Verb', 'verbs'],
  ['Noun', 'nouns']
]

const cache = new Map<string, [number, number, Pos][]>()

export function tagLine(text: string): [number, number, Pos][] {
  const hit = cache.get(text)
  if (hit) return hit
  const out: [number, number, Pos][] = []
  try {
    for (const sentence of nlp(text).json({ offset: true }) as any[]) {
      for (const t of sentence.terms) {
        const found = ORDER.find(([tag]) => t.tags.includes(tag))
        if (found && t.offset) out.push([t.offset.start, t.offset.start + t.offset.length, found[1]])
      }
    }
  } catch {
    // compromise can choke on odd input; just skip highlighting this line.
  }
  if (cache.size > 5000) cache.clear()
  cache.set(text, out)
  return out
}

const marks = Object.fromEntries(ORDER.map(([, k]) => [k, Decoration.mark({ class: `cm-fw-pos-${k}` })])) as Record<Pos, Decoration>

export function partsOfSpeech(cfg: Settings['syntax']): Extension {
  if (!Object.values(cfg).some(Boolean)) return []
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view)
      }
      build(view: EditorView) {
        const b = new RangeSetBuilder<Decoration>()
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos)
            if (line.text.trim() && !isCodeAt(view.state, line.from)) {
              for (const [s, e, kind] of tagLine(line.text)) {
                if (cfg[kind] && !isCodeAt(view.state, line.from + s)) b.add(line.from + s, line.from + e, marks[kind])
              }
            }
            pos = line.to + 1
          }
        }
        return b.finish()
      }
    },
    { decorations: (v) => v.decorations }
  )
}

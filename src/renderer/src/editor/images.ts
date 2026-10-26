// Inline previews for images referenced by content blocks or ![](...) syntax.
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { CONTENT_BLOCK_RE } from './markup'

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i
export const refreshImages = StateEffect.define<null>()

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-fw-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.draggable = false
    img.onerror = () => wrap.classList.add('cm-fw-image-missing')
    wrap.append(img)
    return wrap
  }
  get estimatedHeight() {
    return 200
  }
}

function build(state: EditorState, resolve: (src: string) => string | null): DecorationSet {
  const decos: Range<Decoration>[] = []
  let inFence = false
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    if (/^\s*(```|~~~)/.test(line.text)) inFence = !inFence
    if (inFence) continue
    let src: string | null = null
    let alt = ''
    const block = CONTENT_BLOCK_RE.exec(line.text)
    if (block && IMAGE_EXT.test(block[1].replace(/[?#].*$/, ''))) {
      src = block[1]
      alt = block[2]?.trim().replace(/^"|"$/g, '') ?? ''
    } else {
      const m = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/.exec(line.text)
      if (m) {
        alt = m[1]
        src = m[2]
      }
    }
    if (!src) continue
    const url = resolve(src)
    if (url) decos.push(Decoration.widget({ widget: new ImageWidget(url, alt), block: true, side: 1 }).range(line.to))
  }
  return Decoration.set(decos)
}

export function inlineImages(on: boolean, resolve: (src: string) => string | null): Extension {
  if (!on) return []
  return StateField.define<DecorationSet>({
    create: (state) => build(state, resolve),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((e) => e.is(refreshImages))) return build(tr.state, resolve)
      return value
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}

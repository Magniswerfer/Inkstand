// Outline: the document's headings, for navigation.
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { App } from '../app'
import { clear, debounce, h } from './dom'
import { frontMatterEnd } from '../editor/markup'

export interface Heading {
  level: number
  text: string
  from: number
  line: number
}

export function headings(state: EditorState): Heading[] {
  const out: Heading[] = []
  const fmEnd = frontMatterEnd(state)
  syntaxTree(state).iterate({
    enter: (node) => {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name)
      if (!m) return
      const line = state.doc.lineAt(node.from)
      if (fmEnd > 0 && line.number <= fmEnd) return false
      const text = (m[1] === 'ATX' ? line.text.replace(/^#{1,6}\s*/, '').replace(/\s#+\s*$/, '') : line.text).trim()
      out.push({ level: Number(m[2]), text: text || '(untitled)', from: node.from, line: line.number })
      return false
    }
  })
  return out
}

export class Outline {
  private list: HTMLElement
  private items: { h: Heading; el: HTMLElement }[] = []

  constructor(private app: App, root: HTMLElement) {
    this.list = h('nav', { class: 'ol-list', 'aria-label': 'Outline' })
    root.append(h('div', { class: 'ol-header' }, h('h3', null, 'Outline')), this.list)
  }

  schedule = debounce(() => this.update(), 300)
  scheduleActive = debounce(() => this.markActive(), 100)

  update() {
    if (!this.app.settings.showOutline) return
    const hs = headings(this.app.editor.view.state)
    clear(this.list)
    this.items = hs.map((hd) => {
      const el = h('button', { class: `ol-item ol-h${hd.level}`, onclick: () => this.app.editor.scrollToPos(hd.from) }, hd.text)
      this.list.append(el)
      return { h: hd, el }
    })
    if (!hs.length) this.list.append(h('div', { class: 'sb-empty' }, 'Headings appear here.'))
    this.markActive()
  }

  private markActive() {
    if (!this.app.settings.showOutline) return
    const head = this.app.editor.view.state.selection.main.head
    let active: HTMLElement | null = null
    for (const { h: hd, el } of this.items) {
      el.classList.remove('active')
      if (hd.from <= head) active = el
    }
    active?.classList.add('active')
    active?.scrollIntoView({ block: 'nearest' })
  }
}

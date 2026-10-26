// Quick open, command palette and heading jump: one fuzzy-filtered list.
import type { App } from '../app'
import { basename, clear, dirname, fuzzy, h, relativeTime, stripExt } from './dom'
import { headings } from './outline'
import { isTextFile } from '@shared/text'

export interface PaletteItem {
  label: string
  detail?: string
  hint?: string
  data?: unknown
}

export class Palette {
  private el: HTMLElement | null = null

  constructor(private app: App) {}

  pick(placeholder: string, items: PaletteItem[], onPick: (item: PaletteItem) => void, opts: { onEmptyEnter?: (q: string) => void } = {}) {
    this.close()
    const input = h('input', { class: 'pl-input', placeholder, spellcheck: 'false', 'aria-label': placeholder })
    const list = h('div', { class: 'pl-list', role: 'listbox' })
    let shown: PaletteItem[] = []
    let index = 0
    const render = () => {
      const q = input.value.trim()
      shown = q
        ? items
            .map((it) => ({ it, score: Math.max(fuzzy(q, it.label), fuzzy(q, it.detail ?? '') - 200) }))
            .filter((x) => x.score >= 0)
            .sort((a, b) => b.score - a.score)
            .map((x) => x.it)
        : items
      shown = shown.slice(0, 200)
      index = Math.min(index, Math.max(0, shown.length - 1))
      clear(list)
      shown.forEach((it, i) =>
        list.append(
          h(
            'div',
            { class: `pl-item ${i === index ? 'active' : ''}`, role: 'option', onmousedown: (e: MouseEvent) => (e.preventDefault(), choose(i)) },
            h('span', { class: 'pl-label' }, it.label),
            it.detail ? h('span', { class: 'pl-detail' }, it.detail) : null,
            it.hint ? h('span', { class: 'pl-hint' }, it.hint) : null
          )
        )
      )
      if (!shown.length) list.append(h('div', { class: 'pl-empty' }, opts.onEmptyEnter && q ? `Press Return to create “${q}”` : 'No matches'))
      list.children[index]?.scrollIntoView({ block: 'nearest' })
    }
    const choose = (i: number) => {
      const it = shown[i]
      const q = input.value.trim()
      this.close()
      if (it) onPick(it)
      else if (q && opts.onEmptyEnter) opts.onEmptyEnter(q)
    }
    input.addEventListener('input', () => {
      index = 0
      render()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') index = Math.min(shown.length - 1, index + 1)
      else if (e.key === 'ArrowUp') index = Math.max(0, index - 1)
      else if (e.key === 'Enter') return choose(index)
      else if (e.key === 'Escape') {
        this.close()
        this.app.editor.focus()
        return
      } else return
      e.preventDefault()
      render()
    })
    input.addEventListener('blur', () => setTimeout(() => this.close(), 100))
    this.el = h('div', { class: 'pl-backdrop', onmousedown: (e: MouseEvent) => e.target === this.el && this.close() }, h('div', { class: 'pl-box' }, input, list))
    document.body.append(this.el)
    render()
    input.focus()
  }

  close() {
    this.el?.remove()
    this.el = null
  }

  quickOpen() {
    const recent = this.app.settings.recent
    const files = this.app.files.filter((f) => isTextFile(f.name))
    const seen = new Set(files.map((f) => f.path))
    const extra = recent.filter((p) => !seen.has(p)).map((p) => ({ path: p, name: basename(p), mtime: 0 }))
    const items = [...files, ...extra]
      .sort((a, b) => {
        const ra = recent.indexOf(a.path)
        const rb = recent.indexOf(b.path)
        if (ra >= 0 || rb >= 0) return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb)
        return b.mtime - a.mtime
      })
      .map((f) => ({ label: stripExt(f.name), detail: dirname(f.path).replace(/^\/Users\/[^/]+/, '~'), hint: f.mtime ? relativeTime(f.mtime) : '', data: f.path }))
    this.pick('Open document…', items, (it) => this.app.open(it.data as string), {
      onEmptyEnter: (q) => {
        const dir = this.app.library.saveFolder()
        if (dir) this.app.newDocument(dir, `# ${q}\n\n`)
      }
    })
  }

  commands() {
    const items = [...this.app.commands.values()].filter((c) => !c.hidden).map((c) => ({ label: c.title, data: c.id }))
    this.pick('Run a command…', items, (it) => this.app.run(it.data as string))
  }

  headings() {
    const hs = headings(this.app.editor.view.state)
    this.pick(
      'Go to heading…',
      hs.map((hd) => ({ label: ' '.repeat(hd.level - 1) + hd.text, hint: 'H' + hd.level, data: hd.from })),
      (it) => this.app.editor.scrollToPos(it.data as number)
    )
  }
}

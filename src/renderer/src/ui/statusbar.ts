// Bottom bar: counts, reading time, authorship and quick toggles. Fades while you type.
import type { StatMetric } from '@shared/types'
import type { App } from '../app'
import { authorShares } from '../editor/authorship'
import { computeStats, formatReadingTime, type Stats } from '../stats'
import { clear, debounce, h } from './dom'
import { contextMenu } from './overlay'

const METRICS: StatMetric[] = ['words', 'characters', 'sentences', 'paragraphs', 'readingTime', 'pages']
const LABEL: Record<StatMetric, string> = { words: 'Words', characters: 'Characters', sentences: 'Sentences', paragraphs: 'Paragraphs', readingTime: 'Reading Time', pages: 'Pages' }

function format(metric: StatMetric, s: Stats): string {
  switch (metric) {
    case 'words':
      return `${s.words.toLocaleString()} ${s.words === 1 ? 'word' : 'words'}`
    case 'characters':
      return `${s.characters.toLocaleString()} characters`
    case 'sentences':
      return `${s.sentences.toLocaleString()} sentences`
    case 'paragraphs':
      return `${s.paragraphs.toLocaleString()} paragraphs`
    case 'readingTime':
      return formatReadingTime(s.readingMinutes)
    case 'pages':
      return `${s.pages < 1 ? s.pages.toFixed(1) : Math.round(s.pages)} pages`
  }
}

export class StatusBar {
  private left: HTMLElement
  private right: HTMLElement
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(private app: App, root: HTMLElement) {
    this.left = h('div', { class: 'st-left' })
    this.right = h('div', { class: 'st-right' })
    root.append(this.left, this.right)
    // Like a typewriter: chrome gets out of the way while you write, and returns when you move the mouse.
    app.editor.view.contentDOM.addEventListener('keydown', () => this.fade())
    document.addEventListener('mousemove', () => document.body.classList.remove('typing'))
  }

  private fade() {
    document.body.classList.add('typing')
    clearTimeout(this.idle)
    this.idle = setTimeout(() => document.body.classList.remove('typing'), 2500)
  }

  schedule = debounce(() => this.update(), 200)

  update() {
    const app = this.app
    const s = app.settings
    const sel = app.editor.selectionText()
    const stats = computeStats(sel || app.text, s.wordsPerMinute, s.wordsPerPage)
    clear(this.left)
    clear(this.right)

    const metric = h(
      'button',
      {
        class: 'st-metric',
        title: 'Click to cycle, right-click for all counts',
        onclick: () => app.set({ statMetric: METRICS[(METRICS.indexOf(s.statMetric) + 1) % METRICS.length] }),
        oncontextmenu: (e: MouseEvent) =>
          contextMenu(
            e,
            METRICS.map((m) => ({ label: `${LABEL[m]}: ${format(m, stats)}`, checked: m === s.statMetric, action: () => app.set({ statMetric: m }) }))
          )
      },
      (sel ? 'Selected: ' : '') + format(s.statMetric, stats)
    )
    this.left.append(metric)

    if (s.authorship.enabled && app.text.length) {
      const shares = authorShares(app.editor.spans)
      const others = [...shares.values()].reduce((a, b) => a + b, 0)
      if (others > 0) {
        const total = app.text.length
        const pct = (n: number) => `${Math.round((n / total) * 100)}%`
        const lines = [
          { label: `${s.authorship.author || 'You'}: ${pct(total - others)}`, checked: false },
          ...[...shares].map(([id, n]) => ({ label: `${s.authorship.authors.find((a) => a.id === id)?.name ?? 'Unknown'}: ${pct(n)}`, checked: false }))
        ]
        this.left.append(
          h(
            'button',
            {
              class: 'st-chip',
              title: 'How much of this text you wrote. Click to colour text by author; right-click for a breakdown.',
              onclick: () => app.run('toggleAuthors'),
              oncontextmenu: (e: MouseEvent) =>
                contextMenu(e, [...lines, { separator: true, label: '' }, { label: s.authorship.showBorrowed ? 'Hide Authors' : 'Show Authors', action: () => app.run('toggleAuthors') }])
            },
            `${pct(total - others)} yours`
          )
        )
      }
    }

    const toggle = (label: string, on: boolean, cmd: string, title: string) =>
      h('button', { class: `st-toggle ${on ? 'on' : ''}`, title, 'aria-pressed': String(on), onclick: () => app.run(cmd) }, label)
    const syntaxOn = Object.values(s.syntax).some(Boolean)
    const styleOn = s.styleCheck.fillers || s.styleCheck.cliches || s.styleCheck.redundancies || s.styleCheck.custom.some((c) => c.enabled)
    this.right.append(
      toggle(s.focusMode === 'off' ? 'Focus' : `Focus: ${s.focusMode}`, s.focusMode !== 'off', 'toggleFocus', 'Focus mode (⌘D)'),
      toggle('Typewriter', s.typewriter, 'toggleTypewriter', 'Typewriter mode (⌥⌘Y)'),
      toggle('Syntax', syntaxOn, 'toggleSyntax', 'Highlight parts of speech (⇧⌘Y)'),
      toggle('Style', styleOn, 'toggleStyle', 'Style check (⇧⌘U)'),
      toggle('Preview', s.showPreview, 'togglePreview', 'Preview (⌘R)')
    )
  }
}

// Live preview: renders the document with the chosen template in an isolated iframe.
import type { Settings, TemplateInfo } from '@shared/types'
import type { App } from '../app'
import { resolvedTheme } from '../appearance'
import { buildPage } from '../markdown/template'
import { debounce, h } from './dom'

const api = window.api

export class Preview {
  private frame: HTMLIFrameElement
  private templates: TemplateInfo[] = []
  private loadedKey = ''
  private syncingFromEditor = false

  constructor(private app: App, root: HTMLElement) {
    // No allow-scripts: the page can't run code, but we can still reach into it to update and scroll.
    this.frame = h('iframe', { sandbox: 'allow-same-origin', title: 'Preview' })
    root.append(this.frame)
    this.loadTemplates()
    app.editor.view.scrollDOM.addEventListener('scroll', () => this.syncScroll(), { passive: true })
    new ResizeObserver(() => this.fit()).observe(this.frame)
  }

  async loadTemplates() {
    this.templates = await api.listTemplates()
    this.loadedKey = ''
    this.schedule(true)
    return this.templates
  }

  get list() {
    return this.templates
  }

  template(id: string): TemplateInfo | undefined {
    return this.templates.find((t) => t.id === id) ?? this.templates.find((t) => t.id === 'classic') ?? this.templates[0]
  }

  onSettings(prev: Settings) {
    const s = this.app.settings
    if (prev.previewTemplate !== s.previewTemplate || prev.theme !== s.theme || prev.previewZoom !== s.previewZoom || prev.pdfPaper !== s.pdfPaper || JSON.stringify(prev.page) !== JSON.stringify(s.page)) this.loadedKey = ''
    const content = JSON.stringify(prev.markdown) !== JSON.stringify(s.markdown) || JSON.stringify(prev.links) !== JSON.stringify(s.links)
    if (s.showPreview && (!prev.showPreview || this.loadedKey === '' || content)) this.schedule(true)
  }

  /** Re-reads templates from disk and redraws, for when you're editing a template. */
  async reload() {
    await this.loadTemplates()
    this.schedule(true)
  }

  schedule = debounce((_force?: boolean) => this.update(), 250)

  private async update() {
    if (!this.app.settings.showPreview) return
    const rendered = await this.app.render()
    const theme = resolvedTheme(this.app.settings)
    const t = this.template(this.app.settings.previewTemplate)
    const page = this.app.settings.previewZoom === 'page'
    const key = `${t?.id}|${theme}|${page ? JSON.stringify([this.app.settings.pdfPaper, this.app.settings.page]) : 'width'}`
    const doc = this.frame.contentDocument
    const target = doc?.querySelector('[data-document]') ?? doc?.body
    if (key !== this.loadedKey || !target) {
      // Full reload only when the template or theme changes; otherwise patch the body to avoid flicker.
      this.loadedKey = key
      this.frame.srcdoc = buildPage(t, rendered, this.app.title, { theme, titlePage: false, extraCss: PREVIEW_CSS + (page ? pageCss(this.app.settings) : '') })
      this.frame.onload = () => {
        this.attach()
        this.syncScroll()
      }
      return
    }
    const y = this.frame.contentWindow!.scrollY
    target.innerHTML = rendered.html
    this.frame.contentWindow!.scrollTo(0, y)
    this.syncScroll()
  }

  /** Fit Page: scale the sheet so a whole page fits the pane. */
  private fit() {
    const doc = this.frame.contentDocument
    if (!doc) return
    if (this.app.settings.previewZoom !== 'page') {
      doc.documentElement.style.removeProperty('zoom')
      return
    }
    const [w, h] = paperSize(this.app.settings)
    const zoom = Math.min((this.frame.clientWidth - 32) / w, (this.frame.clientHeight - 32) / h)
    doc.documentElement.style.setProperty('zoom', String(Math.max(0.2, Math.min(zoom, 1.5))))
  }

  private attach() {
    const doc = this.frame.contentDocument
    if (!doc) return
    this.fit()
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element).closest('a')
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#')) doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' })
      else if (href.startsWith('fw-doc:')) this.app.open(decodeURI(href.slice(7)))
      else if (a.dataset.wiki) this.app.openLink({ kind: 'wiki', target: a.dataset.wiki })
      else if (href.startsWith('fw-file:')) api.openExternal(decodeURIComponent(new URL(href).pathname))
      else if (href) api.openExternal(href)
    })
    // Double-click a block to jump to its source line.
    doc.addEventListener('dblclick', (e) => {
      const block = (e.target as Element).closest('[data-line]')
      if (block) this.app.gotoLine(Number(block.getAttribute('data-line')))
    })
  }

  /** Keeps the preview showing the same part of the document as the editor. */
  private syncScroll() {
    if (!this.app.settings.showPreview || !this.app.settings.previewSync || this.syncingFromEditor) return
    const view = this.app.editor.view
    const doc = this.frame.contentDocument
    const win = this.frame.contentWindow
    if (!doc || !win) return
    const scroller = view.scrollDOM
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
      win.scrollTo(0, doc.documentElement.scrollHeight)
      return
    }
    const top = view.lineBlockAtHeight(scroller.scrollTop)
    const line = view.state.doc.lineAt(top.from).number - 1
    const blocks = [...doc.querySelectorAll<HTMLElement>('[data-line]')]
    if (!blocks.length) return
    let before = blocks[0]
    let after: HTMLElement | null = null
    for (const b of blocks) {
      if (Number(b.dataset.line) <= line) before = b
      else {
        after = b
        break
      }
    }
    const bLine = Number(before.dataset.line)
    const aLine = after ? Number(after.dataset.line) : view.state.doc.lines
    const frac = aLine > bLine ? (line - bLine) / (aLine - bLine) : 0
    const bTop = before.getBoundingClientRect().top + win.scrollY
    const aTop = after ? after.getBoundingClientRect().top + win.scrollY : doc.documentElement.scrollHeight
    this.syncingFromEditor = true
    win.scrollTo(0, Math.max(0, bTop + (aTop - bTop) * frac - 24))
    requestAnimationFrame(() => (this.syncingFromEditor = false))
  }
}

const PREVIEW_CSS = `
  html { scroll-behavior: auto; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: rgba(128,128,128,.35); border-radius: 4px; }
`

/** Paper sizes in CSS pixels (96 per inch). */
const PAPER: Record<Settings['pdfPaper'], [number, number]> = { A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344], A5: [559, 794] }

function paperSize(s: Settings): [number, number] {
  const [w, h] = PAPER[s.pdfPaper]
  return s.page.orientation === 'landscape' ? [h, w] : [w, h]
}

/** Shows the document as sheets of paper, with a faint line where each page ends. */
function pageCss(s: Settings) {
  const [w, h] = paperSize(s)
  const mm = (v: number) => Math.round((v * 96) / 25.4)
  const m = s.page.margins
  return `
  html { background: #d9d9d9 !important; }
  html[data-theme='dark'] { background: #0b0b0b !important; }
  body { margin: 0 !important; padding: 16px 0 !important; background: transparent !important; }
  [data-document] {
    box-sizing: border-box; width: ${w}px !important; max-width: none !important; min-height: ${h}px;
    margin: 0 auto !important; padding: ${mm(m.top)}px ${mm(m.right)}px ${mm(m.bottom)}px ${mm(m.left)}px !important; background-color: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08);
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent ${h - 1}px, rgba(0,0,0,.14) ${h - 1}px, rgba(0,0,0,.14) ${h}px);
  }
  html[data-theme='dark'] [data-document] { background-color: #1c1c1c; }
  body[data-document] { margin: 16px auto !important; }
`
}

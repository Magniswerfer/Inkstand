// Export, print and copy in different formats.
import type { PdfOptions } from '@shared/types'
import type { App } from '../app'
import { markdownToDocx } from '../markdown/docx'
import { renderMarkdown } from '../markdown/render'
import { buildPage, fillParts, makeStandalone, partValues } from '../markdown/template'
import { plainText } from '../stats'
import { basename, h, stripExt } from './dom'
import { modal, toast } from './overlay'

const api = window.api
type Format = 'pdf' | 'html' | 'docx' | 'md' | 'txt' | 'print'

const FILTERS: Record<Exclude<Format, 'print'>, { name: string; extensions: string[] }> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  html: { name: 'HTML', extensions: ['html'] },
  docx: { name: 'Word Document', extensions: ['docx'] },
  md: { name: 'Markdown', extensions: ['md'] },
  txt: { name: 'Plain Text', extensions: ['txt'] }
}

async function pdfOptions(app: App, templateId = app.settings.exportTemplate): Promise<PdfOptions> {
  const t = app.preview.template(templateId)
  const r = await app.render()
  const values = partValues(r, app.title)
  return {
    page: app.settings.page,
    html: buildPage(t, r, app.title, { theme: 'light', titlePage: true }),
    baseUrl: t?.baseUrl ?? 'fw-vendor://app/',
    title: values.title,
    headerHtml: fillParts(t?.headerHtml ?? '', values, true),
    footerHtml: fillParts(t?.footerHtml ?? '', values, true),
    headerHeight: t?.headerHeight ?? 60,
    footerHeight: t?.footerHeight ?? 60,
    paper: app.settings.pdfPaper
  }
}

async function loadImage(src: string) {
  try {
    const res = await fetch(src)
    const blob = await res.blob()
    let type = (blob.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
    let data = await blob.arrayBuffer()
    const bitmap = await createImageBitmap(blob)
    // Word only takes raster formats; draw anything else (SVG, WebP) to a PNG.
    if (!['png', 'jpg', 'gif', 'bmp'].includes(type)) {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      data = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
      type = 'png'
    }
    return { data, width: bitmap.width, height: bitmap.height, type: type as 'png' | 'jpg' | 'gif' | 'bmp' }
  } catch {
    return null
  }
}

/** Writes the document to `target` in the given format. */
export async function exportTo(app: App, format: Exclude<Format, 'print'>, target: string, templateId?: string) {
  switch (format) {
    case 'pdf':
      await api.exportPdf(await pdfOptions(app, templateId), target)
      break
    case 'html': {
      const t = app.preview.template(templateId ?? app.settings.exportTemplate)
      const r = await app.render()
      await api.writeFile(target, await makeStandalone(buildPage(t, r, app.title, { theme: 'light', titlePage: true }), (p) => api.readFileBase64(p)))
      break
    }
    case 'docx': {
      const r = await app.render()
      await api.writeBinary(target, await markdownToDocx(r.markdown, r.meta, loadImage))
      break
    }
    case 'md':
      await api.writeFile(target, app.text)
      break
    case 'txt':
      await api.writeFile(target, plainText(app.text).replace(/\n{3,}/g, '\n\n').trim() + '\n')
      break
  }
}

export async function quickExport(app: App, format: Format, templateId?: string) {
  if (format === 'print') {
    await api.print(await pdfOptions(app, templateId))
    return
  }
  const base = app.path ? stripExt(basename(app.path)) : app.title
  const name = `${base}.${FILTERS[format].extensions[0]}`
  const target = await api.showSaveDialog({ defaultPath: app.docDir ? `${app.docDir}/${name}` : name, filters: [FILTERS[format]] })
  if (!target) return
  try {
    await exportTo(app, format, target, templateId)
    toast(`Exported ${basename(target)}.`, { action: { label: 'Show', run: () => api.reveal(target) } })
  } catch (e: any) {
    toast(`Export failed: ${e.message ?? e}`, { error: true })
  }
}

export function openExport(app: App) {
  const formats: [Format, string][] = [
    ['pdf', 'PDF'],
    ['html', 'HTML'],
    ['docx', 'Word (.docx)'],
    ['md', 'Markdown'],
    ['txt', 'Plain text'],
    ['print', 'Print']
  ]
  const fmt = h('select', null, formats.map(([v, l]) => h('option', { value: v }, l)))
  const tpl = h('select', null, app.preview.list.map((t) => h('option', { value: t.id, selected: t.id === app.settings.exportTemplate }, t.name)))
  const form = h(
    'form',
    {
      class: 'fw-prompt',
      onsubmit: (e: Event) => {
        e.preventDefault()
        m.close()
        quickExport(app, fmt.value as Format, tpl.value)
      }
    },
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Format'), fmt),
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Template'), tpl),
    h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, 'Export…'))
  )
  const m = modal('Export', form)
}

/** Copies the selection (or whole document) as HTML source or as rich text for pasting into mail and word processors. */
export async function copyAs(app: App, kind: 'html' | 'rich') {
  const sel = app.editor.selectionText()
  const r = await renderMarkdown(sel || app.text, app.renderContext())
  if (kind === 'html') {
    await navigator.clipboard.writeText(r.html)
    toast('Copied HTML.')
  } else {
    await api.copyRich(r.html, sel || app.text)
    toast('Copied as rich text.')
  }
}

/** Prints the Markdown source as plain text, in the editor's font, with no template. */
export async function printPlainText(app: App) {
  const escape = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const font = getComputedStyle(document.documentElement).getPropertyValue('--fw-font')
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fw-vendor://app/fonts.css"><title>${escape(app.title)}</title>
<style>body { margin: 0; } pre { font: 10.5pt/1.6 ${font}; white-space: pre-wrap; word-wrap: break-word; margin: 0; }</style></head>
<body><pre>${escape(app.text)}</pre></body></html>`
  await api.print({ page: { ...app.settings.page, header: false, footer: false }, html, baseUrl: 'fw-vendor://app/', title: app.title, headerHtml: '', footerHtml: '', headerHeight: 0, footerHeight: 0, paper: app.settings.pdfPaper })
}

/** Page Setup: paper, orientation, margins, and whether templates' headers and footers print. */
export function openPageSetup(app: App) {
  const p = app.settings.page
  const papers = ['A4', 'Letter', 'Legal', 'A5'] as const
  const paper = h('select', null, papers.map((x) => h('option', { selected: app.settings.pdfPaper === x }, x)))
  const orientation = h('select', null, h('option', { value: 'portrait', selected: p.orientation === 'portrait' }, 'Portrait'), h('option', { value: 'landscape', selected: p.orientation === 'landscape' }, 'Landscape'))
  const margin = (v: number) => h('input', { type: 'number', min: 0, max: 80, step: 1, value: String(v), style: 'width: 5em' })
  const top = margin(p.margins.top)
  const right = margin(p.margins.right)
  const bottom = margin(p.margins.bottom)
  const left = margin(p.margins.left)
  const header = h('input', { type: 'checkbox', checked: p.header })
  const footer = h('input', { type: 'checkbox', checked: p.footer })
  const row = (label: string, ...els: (HTMLElement | string)[]) => h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, label), h('span', { class: 'pf-inline' }, ...els))
  const form = h(
    'form',
    {
      class: 'fw-prompt',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        const n = (el: HTMLInputElement) => Math.max(0, Math.min(80, Number(el.value) || 0))
        await app.set({
          pdfPaper: papers[paper.selectedIndex],
          page: { orientation: orientation.value as 'portrait' | 'landscape', margins: { top: n(top), right: n(right), bottom: n(bottom), left: n(left) }, header: header.checked, footer: footer.checked }
        })
        m.close()
      }
    },
    row('Paper size', paper),
    row('Orientation', orientation),
    row('Margins (mm)', 'Top ', top, ' Bottom ', bottom),
    row('', 'Left ', left, ' Right ', right),
    row('Print header', header),
    row('Print footer', footer),
    h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, 'OK'))
  )
  const m = modal('Page Setup', form)
}

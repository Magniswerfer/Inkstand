// Assembles a full HTML page from a template and rendered Markdown, for preview and export.
import katex from 'katex'
import type { TemplateInfo } from '@shared/types'
import type { Rendered } from './render'

export const VENDOR_CSS = ['fw-vendor://app/base.css', 'fw-vendor://katex/katex.min.css']

export interface PartValues {
  title: string
  author: string
  date: string
}

/** Fills iA-style placeholders (data-title, data-author, data-date, data-page-number, data-page-count). */
export function fillParts(html: string, v: PartValues, forPdf: boolean): string {
  if (!html.trim()) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('[data-title]').forEach((el) => (el.textContent = v.title))
  doc.querySelectorAll('[data-author]').forEach((el) => (el.textContent = v.author))
  doc.querySelectorAll('[data-date]').forEach((el) => (el.textContent = v.date))
  doc.querySelectorAll('[data-page-number]').forEach((el) => (el.innerHTML = forPdf ? '<span class="pageNumber"></span>' : ''))
  doc.querySelectorAll('[data-page-count]').forEach((el) => (el.innerHTML = forPdf ? '<span class="totalPages"></span>' : ''))
  // Chromium's header/footer renderer ignores external CSS, so keep layout inline.
  if (forPdf) {
    const root = doc.body.firstElementChild as HTMLElement | null
    if (root) root.style.cssText += ';width:100%;display:flex;justify-content:space-between;align-items:center;gap:1em'
  }
  return doc.body.innerHTML
}

export function partValues(r: Rendered, fallbackTitle: string): PartValues {
  const date = r.meta.date ? new Date(r.meta.date) : new Date()
  return {
    title: r.title || fallbackTitle,
    author: r.meta.author ?? '',
    date: isNaN(date.getTime()) ? r.meta.date : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  }
}

const DEFAULT_DOCUMENT = '<!doctype html><html><head><meta charset="utf-8"></head><body data-document></body></html>'

export interface PageOptions {
  theme: 'light' | 'dark'
  /** Include the template's title part when the document has a front matter title. */
  titlePage: boolean
  extraCss?: string
}

export function buildPage(t: TemplateInfo | undefined, r: Rendered, fallbackTitle: string, opts: PageOptions): string {
  const doc = new DOMParser().parseFromString(t?.documentHtml || DEFAULT_DOCUMENT, 'text/html')
  const head = doc.head
  const base = doc.createElement('base')
  base.href = t?.baseUrl ?? 'fw-vendor://app/'
  head.prepend(base)
  let anchor: Element = base
  for (const href of VENDOR_CSS) {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    anchor.after(link)
    anchor = link
  }
  const meta = doc.createElement('meta')
  meta.name = 'color-scheme'
  meta.content = opts.theme
  head.append(meta)
  if (opts.extraCss) {
    const style = doc.createElement('style')
    style.textContent = opts.extraCss
    head.append(style)
  }
  const title = doc.createElement('title')
  const values = partValues(r, fallbackTitle)
  title.textContent = values.title
  head.append(title)
  doc.documentElement.dataset.theme = opts.theme
  doc.documentElement.classList.toggle('night-mode', opts.theme === 'dark')

  const target = doc.querySelector('[data-document]') ?? doc.body
  const titlePart = opts.titlePage && r.meta.title && t?.titleHtml ? fillParts(t.titleHtml, values, false) : ''
  target.innerHTML = titlePart + r.html
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

/** Inlines stylesheets and images so an exported HTML file works on its own. */
export async function makeStandalone(html: string, readBase64: (path: string) => Promise<string>): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const baseHref = doc.querySelector('base')?.getAttribute('href') ?? ''
  for (const link of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = new URL(link.getAttribute('href')!, baseHref).href
    if (href.includes('katex')) {
      if (!doc.querySelector('.katex')) link.remove()
      else link.setAttribute('href', `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`)
      continue
    }
    try {
      const css = await (await fetch(href)).text()
      const style = doc.createElement('style')
      style.textContent = await inlineCssImports(css, href)
      link.replaceWith(style)
    } catch {
      link.remove()
    }
  }
  for (const img of [...doc.querySelectorAll('img[src^="fw-file:"]')]) {
    const path = decodeURIComponent(new URL(img.getAttribute('src')!).pathname)
    const ext = path.split('.').pop()!.toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    try {
      img.setAttribute('src', `data:${mime};base64,${await readBase64(path)}`)
    } catch {
      // Leave the broken reference.
    }
  }
  doc.querySelector('base')?.remove()
  doc.querySelectorAll('a[href^="fw-doc:"]').forEach((a) => a.setAttribute('href', decodeURI(a.getAttribute('href')!.slice(7)).replace(/^.*\//, '').replace(/\.(md|markdown|txt)$/i, '.html')))
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

async function inlineCssImports(css: string, base: string): Promise<string> {
  const imports = [...css.matchAll(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?[^;]*;/g)]
  for (const m of imports) {
    try {
      const href = new URL(m[1], base).href
      css = css.replace(m[0], await inlineCssImports(await (await fetch(href)).text(), href))
    } catch {
      css = css.replace(m[0], '')
    }
  }
  return css
}

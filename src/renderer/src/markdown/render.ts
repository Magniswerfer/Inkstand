// Markdown → HTML for preview and export. Handles content blocks (file transclusion, images,
// CSV tables, source code), wiki links, math, footnotes, task lists and highlighting.
import MarkdownIt, { type MarkdownIt as MD } from 'markdown-it'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import deflist from 'markdown-it-deflist'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { parseFrontMatter, splitFrontMatter, TAG_RE } from '@shared/text'
import { CONTENT_BLOCK_RE } from '../editor/markup'

export interface RenderContext {
  docPath: string | null
  readFile(path: string): Promise<string>
  /** Turns a relative or absolute local path into a URL the preview can load. */
  fileUrl(path: string): string
  /** Resolves a wiki link target to a document path. */
  resolveWiki(target: string): string | null
}

export interface Rendered {
  html: string
  meta: Record<string, string>
  title: string
  markdown: string
}

const CODE_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', css: 'css', scss: 'scss', html: 'xml',
  xml: 'xml', sql: 'sql', lua: 'lua', r: 'r', pl: 'perl', m: 'objectivec', diff: 'diff', mk: 'makefile'
}
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i
const TEXT_EXT = /\.(md|markdown|mdown|mkd|txt|text)$/i
const TABLE_EXT = /\.(csv|tsv)$/i

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function dirname(p: string) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export function resolvePath(base: string | null, rel: string): string | null {
  if (/^[a-z]+:\/\//i.test(rel)) return rel
  if (!base) return rel.startsWith('/') && rel.split('/').length > 2 ? rel : null
  const parts = (rel.startsWith('/') ? dirname(base) + rel : dirname(base) + '/' + rel).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return '/' + out.map(decodeURIComponent).join('/')
}

export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function csvTable(rows: string[][], caption: string) {
  if (!rows.length) return ''
  const [head, ...body] = rows
  const cells = (r: string[], tag: string) => r.map((c) => `<${tag}>${escapeHtml(c.trim())}</${tag}>`).join('')
  return (
    `<figure class="fw-table"><table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>` +
    body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('') +
    `</tbody></table>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`
  )
}

/** Expands content blocks into Markdown/HTML. Transcluded documents may contain their own blocks. */
export async function expandContentBlocks(md: string, ctx: RenderContext, depth = 0, base = ctx.docPath): Promise<string> {
  const lines = md.split('\n')
  let fence = false
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = !fence ? CONTENT_BLOCK_RE.exec(line) : null
    if (!m) {
      out.push(line)
      continue
    }
    const ref = m[1].trim()
    const caption = m[2]?.trim().replace(/^"|"$/g, '') ?? ''
    const isRemote = /^https?:/i.test(ref)
    const path = isRemote ? ref : resolvePath(base, ref)
    const clean = ref.replace(/[?#].*$/, '')
    if (!path) {
      out.push(line)
      continue
    }
    if (IMAGE_EXT.test(clean)) {
      const src = isRemote ? ref : ctx.fileUrl(path)
      out.push(
        '',
        `<figure class="fw-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`,
        ''
      )
      continue
    }
    if (isRemote) {
      out.push(line)
      continue
    }
    let text: string
    try {
      text = await ctx.readFile(path)
    } catch {
      out.push('', `<p class="fw-missing-block">Missing content block: ${escapeHtml(ref)}</p>`, '')
      continue
    }
    const ext = clean.split('.').pop()!.toLowerCase()
    if (TEXT_EXT.test(clean)) {
      if (depth >= 4) continue
      out.push('', await expandContentBlocks(splitFrontMatter(text).body, ctx, depth + 1, path), '')
    } else if (TABLE_EXT.test(clean)) {
      out.push('', csvTable(parseCsv(text, ext === 'tsv' ? '\t' : ','), caption), '')
    } else {
      const lang = CODE_EXT[ext] ?? ''
      const fenceStr = text.includes('```') ? '~~~~' : '```'
      out.push(fenceStr + lang, text.replace(/\n$/, ''), fenceStr)
      if (caption) out.push('', `<p class="fw-caption">${escapeHtml(caption)}</p>`)
    }
  }
  return out.join('\n')
}

function mathPlugin(md: MD) {
  const render = (src: string, display: boolean) => {
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' })
    } catch {
      return `<code>${escapeHtml(src)}</code>`
    }
  }
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src
    const pos = state.pos
    let open = ''
    if (src.startsWith('\\(', pos)) open = '\\('
    else if (src[pos] === '$' && src[pos + 1] !== '$' && src[pos + 1] !== ' ' && !/\d/.test(src[pos - 1] ?? '')) open = '$'
    if (!open) return false
    const close = open === '$' ? '$' : '\\)'
    let end = src.indexOf(close, pos + open.length)
    while (end > 0 && src[end - 1] === '\\' && open === '$') end = src.indexOf(close, end + 1)
    if (end < 0 || end === pos + open.length) return false
    const content = src.slice(pos + open.length, end)
    if (open === '$' && (content.endsWith(' ') || /^\d/.test(src[end + 1] ?? ''))) return false
    if (!silent) {
      const t = state.push('math_inline', 'math', 0)
      t.content = content
    }
    state.pos = end + close.length
    return true
  })
  md.block.ruler.after('blockquote', 'math_block', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim()
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : ''
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    let content = first.slice(2)
    let line = start
    let found = content.trimEnd().endsWith(close) && content.trim().length >= close.length
    if (found) content = content.trimEnd().slice(0, -close.length)
    while (!found && ++line < end) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
      if (text.trimEnd().endsWith(close)) {
        content += '\n' + text.trimEnd().slice(0, -close.length)
        found = true
      } else content += '\n' + text
    }
    if (!found) return false
    if (silent) return true
    const t = state.push('math_block', 'math', 0)
    t.block = true
    t.content = content
    t.map = [start, line + 1]
    state.line = line + 1
    return true
  })
  md.renderer.rules.math_inline = (tokens, i) => render(tokens[i].content, false)
  md.renderer.rules.math_block = (tokens, i) => `<div class="fw-math">${render(tokens[i].content, true)}</div>\n`
}

function wikiPlugin(md: MD, resolve: () => (target: string) => string | null) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos)) return false
    const end = state.src.indexOf(']]', state.pos + 2)
    if (end < 0) return false
    const inner = state.src.slice(state.pos + 2, end)
    if (!inner || inner.includes('\n') || inner.includes('[')) return false
    if (!silent) {
      const [target, label] = inner.split('|')
      const t = state.push('wikilink', 'a', 0)
      t.meta = { target: target.trim(), label: (label ?? target).trim() }
    }
    state.pos = end + 2
    return true
  })
  md.renderer.rules.wikilink = (tokens, i) => {
    const { target, label } = tokens[i].meta as { target: string; label: string }
    const path = resolve()(target)
    return `<a class="fw-wikilink${path ? '' : ' fw-wikilink-missing'}" href="${path ? 'fw-doc:' + encodeURI(path) : '#'}" data-wiki="${escapeHtml(target)}">${escapeHtml(label)}</a>`
  }
}

function tagPlugin(md: MD) {
  md.core.ruler.push('hashtags', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const out = []
      for (const tok of block.children) {
        if (tok.type !== 'text' || !tok.content.includes('#')) {
          out.push(tok)
          continue
        }
        let last = 0
        for (const m of tok.content.matchAll(TAG_RE)) {
          if (m.index! > last) {
            const t = new state.Token('text', '', 0)
            t.content = tok.content.slice(last, m.index)
            out.push(t)
          }
          const t = new state.Token('hashtag', '', 0)
          t.content = m[1]
          out.push(t)
          last = m.index! + m[0].length
        }
        if (last === 0) out.push(tok)
        else if (last < tok.content.length) {
          const t = new state.Token('text', '', 0)
          t.content = tok.content.slice(last)
          out.push(t)
        }
      }
      block.children = out
    }
  })
  md.renderer.rules.hashtag = (tokens, i) => `<span class="fw-tag">#${escapeHtml(tokens[i].content)}</span>`
}

const ALERTS: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }

/** GitHub-style callouts: a blockquote whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION]. */
function alertPlugin(md: MD) {
  md.core.ruler.after('inline', 'alerts', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open' || tokens[i + 1].type !== 'paragraph_open') continue
      const inline = tokens[i + 2]
      const m = /^\[!(\w+)\][ \t]*(\n|$)/.exec(inline.content)
      const kind = m?.[1].toLowerCase()
      if (!m || !kind || !ALERTS[kind]) continue
      tokens[i].attrJoin('class', `fw-alert fw-alert-${kind}`)
      inline.content = inline.content.slice(m[0].length)
      const kids = inline.children ?? []
      if (kids[0]?.type === 'text') kids[0].content = kids[0].content.replace(/^\[!\w+\][ \t]*/, '')
      while (kids.length && ((kids[0].type === 'text' && !kids[0].content) || kids[0].type === 'softbreak')) kids.shift()
      const title = new state.Token('html_block', '', 0)
      title.content = `<p class="fw-alert-title">${ALERTS[kind]}</p>\n`
      tokens.splice(i + 1, 0, title)
      // An alert with no body leaves an empty paragraph behind; drop it.
      if (!inline.content.trim()) tokens.splice(i + 2, 3)
    }
  })
}

function tocPlugin(md: MD) {
  md.core.ruler.push('toc', (state) => {
    const headings = state.tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.type === 'heading_open')
      .map(({ t, i }) => ({ level: Number(t.tag.slice(1)), id: String(t.attrGet('id') ?? ''), text: state.tokens[i + 1].content }))
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i]
      if (t.type === 'inline' && /^\s*(\[TOC\]|\[\[_?toc_?\]\])\s*$/i.test(t.content) && state.tokens[i - 1]?.type === 'paragraph_open') {
        const html =
          '<nav class="fw-toc"><ul>' +
          headings.map((h) => `<li class="fw-toc-${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join('') +
          '</ul></nav>'
        const tok = new state.Token('html_block', '', 0)
        tok.content = html
        state.tokens.splice(i - 1, 3, tok)
      }
    }
  })
}

/** Adds data-line attributes to blocks so the preview can follow the editor's scroll position. */
function sourceLines(md: MD, lineOffset: () => number) {
  md.core.ruler.push('source_lines', (state) => {
    for (const t of state.tokens) {
      if (t.map && t.nesting >= 0 && t.level === 0 && t.type !== 'inline') t.attrSet('data-line', String(t.map[0] + lineOffset()))
    }
  })
}

let wikiResolver: (t: string) => string | null = () => null
let lineOffset = 0

export function createMarkdown() {
  const md: MD = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code class="language-${escapeHtml(lang)}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch {
          // fall through
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
    }
  })
  md.use(footnote).use(taskLists, { enabled: false, label: true }).use(deflist).use(mark).use(sub).use(sup)
  md.use(anchor, { slugify: (s: string) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') })
  md.use(mathPlugin)
  md.use((m) => wikiPlugin(m, () => wikiResolver))
  md.use(tagPlugin)
  md.use(tocPlugin)
  md.use(alertPlugin)
  md.use((m) => sourceLines(m, () => lineOffset))
  return md
}

const md = createMarkdown()

const purifyConfig = {
  ADD_TAGS: ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd', 'mover', 'munder', 'mstyle', 'mroot', 'mpadded', 'mphantom', 'menclose', 'msubsup', 'munderover'],
  ADD_ATTR: ['data-line', 'data-wiki', 'encoding', 'aria-hidden', 'target'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|fw-file|fw-doc|fw-template|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
}

/** Rewrites relative image/link URLs in rendered HTML so they resolve next to the document. */
function rewriteUrls(html: string, ctx: RenderContext): string {
  return html.replace(/(<img[^>]*\ssrc=|<a[^>]*\shref=|<source[^>]*\ssrc=|<video[^>]*\ssrc=)"([^"]+)"/g, (all, pre, url) => {
    if (/^([a-z][a-z0-9+.-]*:|#)/i.test(url)) return all
    const path = resolvePath(ctx.docPath, url.startsWith('/') ? url : './' + url)
    if (!path) return all
    if (pre.startsWith('<a') && !/\.(md|markdown|txt)$/i.test(path) && !IMAGE_EXT.test(path)) return `${pre}"${escapeHtml(ctx.fileUrl(path))}"`
    if (pre.startsWith('<a')) return `${pre}"fw-doc:${encodeURI(path)}"`
    return `${pre}"${escapeHtml(ctx.fileUrl(path))}"`
  })
}

export async function renderMarkdown(source: string, ctx: RenderContext): Promise<Rendered> {
  const { frontMatter, body, offset } = splitFrontMatter(source)
  const meta = parseFrontMatter(frontMatter)
  const expanded = await expandContentBlocks(body, ctx)
  wikiResolver = ctx.resolveWiki
  // Line numbers only match the editor when no content block changed the line count.
  lineOffset = source.slice(0, offset).split('\n').length - 1
  const raw = md.render(expanded)
  const html = DOMPurify.sanitize(rewriteUrls(raw, ctx), purifyConfig) as string
  const firstHeading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '')
  return { html, meta, title: meta.title || firstHeading || '', markdown: expanded }
}

export function markdownTokens(src: string) {
  return md.parse(src, {})
}

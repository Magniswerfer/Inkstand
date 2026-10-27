// Markdown → Microsoft Word, built from markdown-it tokens.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild
} from 'docx'
import type { Token } from 'markdown-it'
import { markdownTokens } from './render'

interface Ctx {
  footnotes: Record<number, { children: Paragraph[] }>
  footnoteIds: Map<string, number>
  loadImage(src: string): Promise<{ data: ArrayBuffer; width: number; height: number; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null>
}

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
  highlight?: boolean
  sub?: boolean
  sup?: boolean
  link?: string
}

// markdown-it keeps plugin data in token.meta without types.
const tokMeta = (t: Token): any => t.meta ?? {}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
const MAX_IMAGE_WIDTH = 600

function run(text: string, s: RunStyle): TextRun {
  const opts: IRunOptions = {
    text,
    bold: s.bold,
    italics: s.italics,
    strike: s.strike,
    font: s.code ? 'Menlo' : undefined,
    shading: s.code ? { type: ShadingType.CLEAR, fill: 'F1F1F1', color: 'auto' } : undefined,
    highlight: s.highlight ? 'yellow' : undefined,
    subScript: s.sub,
    superScript: s.sup,
    style: s.link ? 'Hyperlink' : undefined
  }
  return new TextRun(opts)
}

async function inline(tokens: Token[], ctx: Ctx, base: RunStyle = {}): Promise<ParagraphChild[]> {
  const out: ParagraphChild[] = []
  const style: RunStyle = { ...base }
  let linkRuns: ParagraphChild[] | null = null
  let linkHref = ''
  const push = (c: ParagraphChild) => (linkRuns ? linkRuns.push(c) : out.push(c))

  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        push(run(t.content, style))
        break
      case 'code_inline':
        push(run(t.content, { ...style, code: true }))
        break
      case 'softbreak':
        push(run(' ', style))
        break
      case 'hardbreak':
        push(new TextRun({ break: 1 }))
        break
      case 'strong_open':
        style.bold = true
        break
      case 'strong_close':
        style.bold = base.bold
        break
      case 'em_open':
        style.italics = true
        break
      case 'em_close':
        style.italics = base.italics
        break
      case 's_open':
        style.strike = true
        break
      case 's_close':
        style.strike = false
        break
      case 'mark_open':
        style.highlight = true
        break
      case 'mark_close':
        style.highlight = false
        break
      case 'sub_open':
        style.sub = true
        break
      case 'sub_close':
        style.sub = false
        break
      case 'sup_open':
        style.sup = true
        break
      case 'sup_close':
        style.sup = false
        break
      case 'link_open':
        linkHref = String(t.attrGet('href') ?? '')
        linkRuns = []
        style.link = linkHref
        break
      case 'link_close': {
        const children = linkRuns ?? []
        linkRuns = null
        style.link = undefined
        if (/^(https?|mailto):/.test(linkHref)) out.push(new ExternalHyperlink({ link: linkHref, children: children as any }))
        else out.push(...children)
        break
      }
      case 'wikilink':
        push(run(tokMeta(t).label, style))
        break
      case 'hashtag':
        push(run('#' + t.content, style))
        break
      case 'math_inline':
        push(run(t.content, { ...style, italics: true }))
        break
      case 'footnote_ref': {
        const id = ctx.footnoteIds.get(tokMeta(t).label ?? String(tokMeta(t).id)) ?? tokMeta(t).id + 1
        push(new FootnoteReferenceRun(id))
        break
      }
      case 'image': {
        const img = await ctx.loadImage(String(t.attrGet('src') ?? ''))
        if (img) push(imageRun(img))
        else push(run(`[${t.content}]`, style))
        break
      }
      case 'html_inline':
        if (/^<br\s*\/?>$/i.test(t.content)) push(new TextRun({ break: 1 }))
        else if (/type="checkbox"/.test(t.content)) push(run(/checked/.test(t.content) ? '☑ ' : '☐ ', style))
        break
      default:
        if (t.children) out.push(...(await inline(t.children, ctx, style)))
        else if (t.content) push(run(t.content, style))
    }
  }
  return out
}

function imageRun(img: NonNullable<Awaited<ReturnType<Ctx['loadImage']>>>) {
  const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width)
  return new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } })
}

/** Finds the index of the token closing the one at `start`. */
function closing(tokens: Token[], start: number): number {
  let depth = 0
  for (let i = start; i < tokens.length; i++) {
    depth += tokens[i].nesting
    if (depth === 0) return i
  }
  return tokens.length - 1
}

interface BlockOpts {
  quote?: number
  list?: { ordered: boolean; level: number; instance: number }
}

let listInstance = 0

async function blocks(tokens: Token[], ctx: Ctx, opts: BlockOpts = {}): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = []
  const indent = opts.quote ? { left: 720 * opts.quote } : undefined
  const quoteBorder = opts.quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 12 } } : undefined
  let firstInItem = true

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) - 1
        out.push(new Paragraph({ heading: HEADINGS[level], children: await inline(tokens[i + 1].children ?? [], ctx) }))
        i += 2
        break
      }
      case 'paragraph_open': {
        const children = await inline(tokens[i + 1].children ?? [], ctx)
        const list = opts.list && firstInItem ? opts.list : undefined
        out.push(
          new Paragraph({
            children,
            indent: list ? undefined : opts.list ? { left: 720 * (opts.list.level + 1) } : indent,
            border: quoteBorder,
            numbering: list ? { reference: list.ordered ? 'ordered' : 'bullets', level: Math.min(list.level, 8), instance: list.instance } : undefined,
            style: opts.quote ? 'Quote' : undefined
          })
        )
        firstInItem = false
        i += 2
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const end = closing(tokens, i)
        const ordered = t.type === 'ordered_list_open'
        const level = opts.list ? opts.list.level + 1 : 0
        const instance = ++listInstance
        for (let j = i + 1; j < end; j++) {
          if (tokens[j].type !== 'list_item_open') continue
          const itemEnd = closing(tokens, j)
          out.push(...(await blocks(tokens.slice(j + 1, itemEnd), ctx, { ...opts, list: { ordered, level, instance } })))
          j = itemEnd
        }
        i = end
        break
      }
      case 'blockquote_open': {
        const end = closing(tokens, i)
        out.push(...(await blocks(tokens.slice(i + 1, end), ctx, { quote: (opts.quote ?? 0) + 1 })))
        i = end
        break
      }
      case 'fence':
      case 'code_block': {
        const lines = t.content.replace(/\n$/, '').split('\n')
        out.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: 'F5F5F5', color: 'auto' },
            spacing: { before: 120, after: 120 },
            indent,
            children: lines.flatMap((l, n) => [...(n ? [new TextRun({ break: 1 })] : []), new TextRun({ text: l || ' ', font: 'Menlo', size: 18 })])
          })
        )
        break
      }
      case 'math_block':
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t.content.trim(), italics: true })] }))
        break
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } }, children: [] }))
        break
      case 'table_open': {
        const end = closing(tokens, i)
        out.push(await table(tokens.slice(i + 1, end), ctx))
        i = end
        break
      }
      case 'html_block':
        out.push(...(await htmlBlock(t.content, ctx)))
        break
      case 'dl_open': {
        const end = closing(tokens, i)
        for (let j = i + 1; j < end; j++) {
          if (tokens[j].type === 'dt_open') {
            out.push(new Paragraph({ children: await inline(tokens[j + 1].children ?? [], ctx, { bold: true }) }))
            j += 2
          } else if (tokens[j].type === 'dd_open') {
            const ddEnd = closing(tokens, j)
            for (const p of await blocks(tokens.slice(j + 1, ddEnd), ctx)) out.push(p)
            j = ddEnd
          }
        }
        i = end
        break
      }
      case 'footnote_block_open':
        i = closing(tokens, i)
        break
    }
  }
  return out
}

async function table(tokens: Token[], ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = []
  let header = true
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'tbody_open') header = false
    if (t.type !== 'tr_open') continue
    const end = closing(tokens, i)
    const cells: TableCell[] = []
    for (let j = i + 1; j < end; j++) {
      if (tokens[j].type !== 'th_open' && tokens[j].type !== 'td_open') continue
      const style = String(tokens[j].attrGet('style') ?? '')
      const alignment = style.includes('center') ? AlignmentType.CENTER : style.includes('right') ? AlignmentType.RIGHT : AlignmentType.LEFT
      cells.push(
        new TableCell({
          children: [new Paragraph({ alignment, children: await inline(tokens[j + 1].children ?? [], ctx, { bold: header }) })],
          shading: header ? { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined
        })
      )
      j += 2
    }
    rows.push(new TableRow({ children: cells, tableHeader: header }))
    i = end
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

/** Content blocks expand to small HTML snippets (figures, CSV tables); translate the common ones. */
async function htmlBlock(html: string, ctx: Ctx): Promise<(Paragraph | Table)[]> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: (Paragraph | Table)[] = []
  for (const img of doc.querySelectorAll('img')) {
    const data = await ctx.loadImage(img.getAttribute('src') ?? '')
    if (data) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [imageRun(data)] }))
  }
  for (const tbl of doc.querySelectorAll('table')) {
    const rows = [...tbl.querySelectorAll('tr')].map(
      (tr, ri) =>
        new TableRow({
          tableHeader: ri === 0 && !!tr.querySelector('th'),
          children: [...tr.querySelectorAll('th,td')].map(
            (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.textContent ?? '', bold: c.tagName === 'TH' })] })] })
          )
        })
    )
    if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
  }
  for (const cap of doc.querySelectorAll('figcaption, .fw-caption')) {
    out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: cap.textContent ?? '', italics: true, size: 18 })] }))
  }
  if (!out.length) {
    const text = doc.body.textContent?.trim()
    if (text) out.push(new Paragraph({ children: [new TextRun(text)] }))
  }
  return out
}

async function collectFootnotes(tokens: Token[], ctx: Ctx) {
  let n = 0
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'footnote_open') continue
    const end = closing(tokens, i)
    const id = ++n
    ctx.footnoteIds.set(tokMeta(tokens[i]).label ?? String(tokMeta(tokens[i]).id), id)
    const body = tokens.slice(i + 1, end).filter((t) => t.type !== 'footnote_anchor')
    ctx.footnotes[id] = { children: (await blocks(body, ctx)).filter((p): p is Paragraph => p instanceof Paragraph) }
    i = end
  }
}

export async function markdownToDocx(markdown: string, meta: Record<string, string>, loadImage: Ctx['loadImage']): Promise<ArrayBuffer> {
  const tokens = markdownTokens(markdown)
  const ctx: Ctx = { footnotes: {}, footnoteIds: new Map(), loadImage }
  listInstance = 0
  await collectFootnotes(tokens, ctx)
  // Footnote ids in references come from markdown-it's own numbering; map labels on the way.
  for (const t of tokens) {
    for (const c of t.children ?? []) {
      if (c.type === 'footnote_ref') {
        const key = tokMeta(c).label ?? String(tokMeta(c).id)
        if (!ctx.footnoteIds.has(key)) ctx.footnoteIds.set(key, tokMeta(c).id + 1)
      }
    }
  }
  const body = await blocks(tokens, ctx)
  if (meta.title) body.unshift(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(meta.title)] }))

  const levels = (ordered: boolean) =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format: ordered ? [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3] : LevelFormat.BULLET,
      text: ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3],
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
    }))

  const doc = new Document({
    title: meta.title,
    creator: meta.author || 'Inkstand',
    description: meta.description,
    footnotes: ctx.footnotes,
    styles: {
      default: { document: { run: { font: 'Georgia', size: 23 }, paragraph: { spacing: { after: 160, line: 300 } } } },
      paragraphStyles: [
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { italics: true, color: '555555' } }
      ]
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: levels(false) },
        { reference: 'ordered', levels: levels(true) }
      ]
    },
    sections: [{ children: body }]
  })
  const blob = await Packer.toBlob(doc)
  return blob.arrayBuffer()
}

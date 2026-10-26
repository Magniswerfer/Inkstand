import { promises as fs, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { TemplateInfo } from '@shared/types'
import { dataPath, resourcePath } from './paths'

/** Where each template's files live on disk, by template id (used by the fw-template:// protocol). */
const roots = new Map<string, string>()

export const userTemplatesDir = () => dataPath('templates')

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template'
}

/** Reads the handful of keys we need from an iA Writer style Info.plist. */
function readPlist(xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of xml.matchAll(/<key>([^<]+)<\/key>\s*<(string|integer|real)>([^<]*)<\/\2>/g)) out[m[1]] = m[3]
  return out
}

async function read(path: string) {
  return existsSync(path) ? fs.readFile(path, 'utf8') : ''
}

async function load(dir: string, id: string, builtIn: boolean): Promise<TemplateInfo | null> {
  try {
    // Native format: template.json beside the html files.
    const json = join(dir, 'template.json')
    if (existsSync(json)) {
      const meta = JSON.parse(await fs.readFile(json, 'utf8'))
      roots.set(id, dir)
      return {
        id,
        builtIn,
        name: meta.name ?? basename(dir),
        description: meta.description ?? '',
        author: meta.author ?? '',
        baseUrl: `fw-template://${id}/`,
        documentHtml: await read(join(dir, meta.document ?? 'document.html')),
        headerHtml: meta.header ? await read(join(dir, meta.header)) : '',
        footerHtml: meta.footer ? await read(join(dir, meta.footer)) : '',
        titleHtml: meta.title ? await read(join(dir, meta.title)) : '',
        headerHeight: meta.headerHeight ?? 60,
        footerHeight: meta.footerHeight ?? 60
      }
    }
    // Compatibility: iA Writer .iatemplate bundles.
    const plistPath = join(dir, 'Contents', 'Info.plist')
    if (existsSync(plistPath)) {
      const p = readPlist(await fs.readFile(plistPath, 'utf8'))
      const res = join(dir, 'Contents', 'Resources')
      const file = (key: string) => (p[key] ? join(res, p[key].endsWith('.html') ? p[key] : p[key] + '.html') : '')
      roots.set(id, res)
      return {
        id,
        builtIn,
        name: p.CFBundleName ?? basename(dir, extname(dir)),
        description: p.IATemplateDescription ?? '',
        author: p.IATemplateAuthor ?? '',
        baseUrl: `fw-template://${id}/`,
        documentHtml: await read(file('IATemplateDocumentFile')),
        headerHtml: p.IATemplateHeaderFile ? await read(file('IATemplateHeaderFile')) : '',
        footerHtml: p.IATemplateFooterFile ? await read(file('IATemplateFooterFile')) : '',
        titleHtml: p.IATemplateTitleFile ? await read(file('IATemplateTitleFile')) : '',
        headerHeight: Number(p.IATemplateHeaderHeight ?? 60),
        footerHeight: Number(p.IATemplateFooterHeight ?? 60)
      }
    }
  } catch (err) {
    console.error('Could not load template', dir, err)
  }
  return null
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const out: TemplateInfo[] = []
  const builtInDir = resourcePath('templates')
  for (const name of (await fs.readdir(builtInDir).catch(() => [])).sort()) {
    const t = await load(join(builtInDir, name), slug(name), true)
    if (t) out.push(t)
  }
  await fs.mkdir(userTemplatesDir(), { recursive: true })
  for (const name of (await fs.readdir(userTemplatesDir())).sort()) {
    if (name.startsWith('.')) continue
    const t = await load(join(userTemplatesDir(), name), 'user-' + slug(name), false)
    if (t) out.push(t)
  }
  return out
}

export async function importTemplate(src: string): Promise<TemplateInfo | null> {
  const name = basename(src)
  const dest = join(userTemplatesDir(), name)
  await fs.mkdir(userTemplatesDir(), { recursive: true })
  await fs.cp(src, dest, { recursive: true, force: true })
  const t = await load(dest, 'user-' + slug(name), false)
  if (!t) await fs.rm(dest, { recursive: true, force: true })
  return t
}

export async function removeTemplate(id: string) {
  const dir = roots.get(id)
  if (!dir || !id.startsWith('user-')) return
  // For iA bundles the root is Contents/Resources; remove the whole bundle.
  const bundle = dir.endsWith(join('Contents', 'Resources')) ? join(dir, '..', '..') : dir
  await fs.rm(bundle, { recursive: true, force: true })
  roots.delete(id)
}

export function templateFile(id: string, rel: string): string | null {
  const root = roots.get(id)
  if (!root) return null
  const full = join(root, rel)
  return full.startsWith(root) ? full : null
}

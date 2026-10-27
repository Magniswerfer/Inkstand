// Exercises content blocks and every exporter against a temporary library.
// Usage: node test/e2e/exports.mjs <outDir> [path/to/some.iatemplate]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync, statSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

const out = process.argv[2] ?? tmpdir()
const iaTemplate = process.argv[3]
const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
mkdirSync(join(lib, 'assets'))
// 2×2 red PNG
writeFileSync(join(lib, 'assets', 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'))
writeFileSync(join(lib, 'data.csv'), 'City,Population\nCopenhagen,"660,000"\nAarhus,"290,000"\n')
writeFileSync(join(lib, 'Part.md'), 'This paragraph comes from **Part.md**.\n')
writeFileSync(
  join(lib, 'Report.md'),
  `---
title: Quarterly Report
author: Ada Lovelace
date: 2026-10-26
---

# Summary

Intro paragraph with a [link](https://example.com) and ==highlight==.

/assets/dot.png "A red dot"

/data.csv "Danish cities"

/Part.md

1. One
2. Two
   - Nested

\`\`\`js
const x = 1
\`\`\`

$$
\\int_0^1 x^2 dx
$$

Term
: Definition
`
)
if (iaTemplate && existsSync(iaTemplate)) cpSync(iaTemplate, join(userData, 'templates', basename(iaTemplate)), { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib] }))

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
const logs = []
win.on('console', (m) => m.type() === 'error' && logs.push(m.text()))
await win.waitForTimeout(1200)
await win.evaluate((p) => window.fw.open(p), join(lib, 'Report.md'))
await win.waitForTimeout(800)
await win.screenshot({ path: join(out, 'e1-blocks-editor.png') })

const rendered = await win.evaluate(async () => {
  const r = await window.fw.render()
  return { fig: (r.html.match(/<figure/g) ?? []).length, table: r.html.includes('Copenhagen'), part: r.html.includes('Part.md'), math: r.html.includes('katex'), dl: r.html.includes('<dl') }
})
console.log('render', JSON.stringify(rendered))

const templates = await win.evaluate(async () => (await window.api.listTemplates()).map((t) => t.id + ':' + t.name))
console.log('templates', templates.join(', '))

for (const [fmt, tpl] of [['pdf', 'classic'], ['pdf', 'modern'], ['docx'], ['html', 'classic'], ['txt'], ['md']]) {
  const target = join(out, `export-${tpl ?? 'x'}.${fmt}`)
  try {
    await win.evaluate(([f, t, tp]) => window.fw.exportTo(f, t, tp), [fmt, target, tpl])
    console.log('OK  ', fmt, tpl ?? '', statSync(target).size, 'bytes')
  } catch (e) {
    console.log('FAIL', fmt, e.message)
  }
}
const ia = templates.find((t) => t.startsWith('user-'))
if (ia) {
  const target = join(out, 'export-ia.pdf')
  await win.evaluate(([t, tp]) => window.fw.exportTo('pdf', t, tp), [target, ia.split(':')[0]])
  console.log('OK   pdf with imported iA template', statSync(target).size, 'bytes')
}

await win.evaluate(() => window.fw.set({ showPreview: true }))
await win.waitForTimeout(1500)
await win.screenshot({ path: join(out, 'e2-blocks-preview.png') })
console.log('versions', await win.evaluate(async () => (await window.api.listVersions(window.fw.path)).length))
console.log('errors', logs.join('\n') || 'none')
await app.close()

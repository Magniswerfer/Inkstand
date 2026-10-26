// Launches the built app against a temporary library and takes screenshots.
// Usage: node test/e2e/smoke.mjs <outDir>
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? tmpdir()
const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
mkdirSync(join(lib, 'Notes'))
writeFileSync(join(lib, 'Notes', 'Ideas.md'), '# Ideas\n\nA list of #ideas worth exploring.\n')
writeFileSync(
  join(lib, 'Essay.md'),
  `---
title: On Writing
author: Ada
---

# On Writing

Writing is basically thinking on paper. At the end of the day, the end result is what really matters. The quick brown fox jumps over the lazy dog and runs away.

## Structure

- First point with **bold** and _italic_
- [ ] A task
- See [[Ideas]] and #drafts

> A quote worth keeping.

| Name | Value |
|---|---|
| a | 1 |

Math: $E = mc^2$ and a footnote.[^1]

[^1]: The note.
`
)
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib], recent: [join(lib, 'Essay.md')] }))

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } })
const logs = []
const win = await app.firstWindow()
win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await win.setViewportSize({ width: 1280, height: 820 })
await win.waitForTimeout(2000)
await win.screenshot({ path: join(out, '1-open.png') })

const check = async (label, fn) => {
  try {
    const r = await fn()
    console.log('OK  ', label, r ?? '')
  } catch (e) {
    console.log('FAIL', label, e.message)
  }
}

await check('title shows document', async () => (await win.textContent('.doc-title')))
await check('library lists files', async () => (await win.$$eval('.sb-item', (els) => els.map((e) => e.textContent.trim()).join(' | '))))
await check('stats', async () => await win.textContent('.st-metric'))

// Preview
await win.evaluate(() => window.fw.set({ showPreview: true, showOutline: true }))
await win.waitForTimeout(1500)
await win.screenshot({ path: join(out, '2-preview.png') })
await check('preview rendered', async () => {
  const frame = win.frameLocator('#preview iframe')
  return (await frame.locator('h1').first().textContent()) + ' / katex=' + (await frame.locator('.katex').count()) + ' / table=' + (await frame.locator('table').count())
})
await check('outline', async () => await win.$$eval('.ol-item', (els) => els.map((e) => e.textContent).join(' | ')))

// Focus, syntax and style check
await win.evaluate(() => window.fw.set({ showPreview: false, showOutline: false, focusMode: 'sentence', syntax: { adjectives: true, nouns: true, adverbs: true, verbs: true, conjunctions: true }, styleCheck: { fillers: true, cliches: true, redundancies: true, custom: [], ignored: [] } }))
await win.click('.cm-content')
await win.evaluate(() => {
  const v = window.fw.editor.view
  const pos = v.state.doc.toString().indexOf('quick brown')
  v.dispatch({ selection: { anchor: pos } })
  v.focus()
})
await win.waitForTimeout(800)
await win.screenshot({ path: join(out, '3-focus-syntax-style.png') })
await check('style issues', async () => await win.$$eval('.cm-fw-style', (els) => els.map((e) => e.textContent).join(' | ')))
await check('pos marks', async () => await win.$$eval('[class*=cm-fw-pos-]', (els) => els.length))

// Typing: smart quotes, autosave, authorship
await win.evaluate(() => window.fw.set({ focusMode: 'off', syntax: { adjectives: false, nouns: false, adverbs: false, verbs: false, conjunctions: false }, styleCheck: { fillers: false, cliches: false, redundancies: false, custom: [], ignored: [] } }))
await win.evaluate(() => {
  const v = window.fw.editor.view
  v.dispatch({ selection: { anchor: v.state.doc.length } })
  v.focus()
})
await win.keyboard.type('\nShe said "hello" -- it\'s fine...')
await win.waitForTimeout(1800)
await check('smart typography', async () => (await win.evaluate(() => window.fw.text.split('\n').pop())))
await check('autosaved', async () => (await win.evaluate(() => !window.fw.dirty)))

// New document via palette, save into library
await win.evaluate(() => window.fw.newDocument())
await win.keyboard.type('# Fresh note\n\nSome words here.')
await win.waitForTimeout(1800)
await check('new doc saved to', async () => await win.evaluate(() => window.fw.path))

// Export
await check('docx export', async () => {
  const { markdownToDocx } = await win.evaluate(async () => {
    const r = await window.fw.render()
    return { markdownToDocx: r.markdown.length }
  })
  return markdownToDocx
})

await win.evaluate(() => window.fw.set({ theme: 'dark' }))
await win.evaluate(() => window.fw.open(window.fw.settings.recent[1] ?? window.fw.settings.recent[0]))
await win.waitForTimeout(800)
await win.screenshot({ path: join(out, '4-dark.png') })

await win.evaluate(() => window.fw.palette.quickOpen())
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '5-quickopen.png') })
await win.keyboard.press('Escape')

await win.evaluate(() => window.fw.run('preferences'))
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '6-prefs.png') })

console.log('\nLOGS:\n' + logs.filter((l) => !l.includes('Electron Security Warning')).join('\n'))
await app.close()

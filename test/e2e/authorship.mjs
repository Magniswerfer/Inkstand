// Authorship stored in the file, end to end, headless.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
const doc = join(lib, 'Essay.md')
const other = join(lib, 'Other.md')
writeFileSync(doc, 'I wrote this.\n')
writeFileSync(other, 'Elsewhere.\n')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib] }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
let failed = 0
const check = (label, ok, got) => {
  if (!ok) failed++
  console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : JSON.stringify(got))
}
const spans = () => win.evaluate(() => window.fw.editor.spans)

await win.evaluate((p) => window.fw.open(p), doc)
await win.evaluate(() => {
  const v = window.fw.editor.view
  v.dispatch({ changes: { from: v.state.doc.length, insert: 'Pasted words.\n' }, userEvent: 'input.paste' })
})
let s = await spans()
check('paste credited to Pasted', s.length === 1 && s[0][2] === 'pasted', s)
await win.evaluate(() => window.fw.save())
let disk = readFileSync(doc, 'utf8')
check('block written to file', /<!-- Authorship · Inkstand\nsha256: [0-9a-f]{64}\n@Pasted \[reference\]: 14-28\n-->/.test(disk), disk)

await win.evaluate((p) => window.fw.open(p), other)
await win.evaluate((p) => window.fw.open(p), doc)
check('editor never shows the block', !(await win.evaluate(() => window.fw.text)).includes('Authorship'), null)
s = await spans()
check('spans restored on reopen', JSON.stringify(s) === JSON.stringify([[14, 28, 'pasted']]), s)

await win.evaluate(() => window.fw.editor.view.dispatch({ selection: { anchor: 0, head: 1 } }))
await win.evaluate(() => window.fw.run('markAs', 'pasted'))
await win.evaluate(() => window.fw.editor.view.dispatch({ selection: { anchor: 14, head: 28 } }))
await win.evaluate(() => window.fw.run('markAs', ''))
s = await spans()
check('Mark As credits and uncredits', JSON.stringify(s) === JSON.stringify([[0, 1, 'pasted']]), s)

await win.evaluate(() => window.fw.editor.view.dispatch({ selection: { anchor: 0 } }))
await win.evaluate(() => {
  const ai = { id: 'gpt', name: 'ChatGPT', kind: 'ai', color: '#7b3fb0' }
  return window.fw.set({ authorship: { ...window.fw.settings.authorship, authors: [...window.fw.settings.authorship.authors, ai] } })
})
await win.evaluate(() => navigator.clipboard.writeText('I wrote this.\nPasted words, now better.\n').catch(() => {}))
const edited = await win.evaluate(async () => {
  // Clipboard access can be denied off-screen; call the command's core directly with the text.
  window.fw.editor.view.dispatch({ selection: { anchor: 0 } })
  await window.fw.run('pasteEdits', 'gpt')
  await new Promise((r) => setTimeout(r, 300))
  return { text: window.fw.text, spans: window.fw.editor.spans }
})
check('Paste Edits From credits only changed words', edited.text === 'I wrote this.\nPasted words, now better.\n' && edited.spans.some(([a, b, who]) => who === 'gpt' && edited.text.slice(a, b).includes('better')), edited)
await win.evaluate(() => window.fw.save())

// An edit made by another app makes the stored ranges untrustworthy.
writeFileSync(doc, readFileSync(doc, 'utf8').replace('I wrote', 'You wrote'))
await win.evaluate((p) => window.fw.open(p), other)
await win.evaluate((p) => window.fw.open(p), doc)
s = await spans()
check('outside edits reset authorship', s.length === 0, s)

const md = await win.evaluate(async () => (await window.fw.render()).html)
check('rendered output has no block', !md.includes('Authorship'), null)

app.close().catch(() => {})
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)

// Editing commands in the real editor, headless.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [] }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
let failed = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (!ok) failed++
  console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : JSON.stringify(got))
}
const text = () => win.evaluate(() => window.fw.text)
const setDoc = (doc, at) => win.evaluate(([d, a]) => { window.fw.editor.setDoc(d); const v = window.fw.editor.view; v.dispatch({ selection: { anchor: a ?? d.length } }); v.focus() }, [doc, at])
const run = (cmd, arg) => win.evaluate(([c, a]) => window.fw.run(c, a), [cmd, arg])

await setDoc('| a | b |\n| --- | --- |\n| 1 | 2 |', 2)
await win.keyboard.press('Tab')
check('Tab moves to next cell', await win.evaluate(() => { const v = window.fw.editor.view; const h = v.state.selection.main.head; return v.state.sliceDoc(h, h + 1) }), 'b')
await win.evaluate(() => { const v = window.fw.editor.view; v.dispatch({ selection: { anchor: v.state.doc.length - 3 } }) })
await win.keyboard.press('Tab')
await win.keyboard.type('x')
check('Tab past last cell adds a row', (await text()).split('\n').length, 4)
await run('table', 'colAfter')
check('Add column after', (await text()).split('\n')[0].split('|').length - 2, 3)
await run('table', 'sortDesc')
check('sort keeps header first', (await text()).split('\n')[0].includes('a'), true)

await setDoc('the lord of the rings', 0)
await win.evaluate(() => window.fw.editor.view.dispatch({ selection: { anchor: 0, head: 21 } }))
await run('case', 'title')
check('Title Case', await text(), 'The Lord of the Rings')

await setDoc('Mind the gap.', 0)
await run('callout', 'warning')
check('callout inserted', await text(), '> [!WARNING]\n> Mind the gap.')
const html = await win.evaluate(async () => (await window.fw.render()).html)
check('callout rendered', html, (h) => h.includes('fw-alert-warning') && h.includes('fw-alert-title'))

await setDoc('note', 4)
await run('comment')
check('comment toggles on', await text(), '<!-- note -->')
await run('comment')
check('comment toggles off', await text(), 'note')

await setDoc('', 0)
await run('insertMath')
check('display math', await text(), '$$\n\n$$\n')
await setDoc('Intro', 5)
await run('insertToc')
check('TOC on its own line', await text(), 'Intro\n\n[TOC]\n')

app.close().catch(() => {})
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)

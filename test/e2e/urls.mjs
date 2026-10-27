// URL commands, headless. x-callback replies are captured, never opened.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
mkdirSync(join(lib, 'Inbox'))
writeFileSync(join(lib, 'Log.md'), '# Log\n\nFirst entry.\n')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib], urlToken: 'secret' }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
await app.evaluate(({ shell }) => {
  globalThis.__opened = []
  shell.openExternal = async (u) => void globalThis.__opened.push(u)
})
let failed = 0
const check = (label, ok, got) => {
  if (!ok) failed++
  console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : JSON.stringify(got))
}
const run = (url) => app.evaluate(async (_e, u) => globalThis.__fwHandleUrl(u), url)
const opened = () => app.evaluate(() => globalThis.__opened.splice(0))
const enc = encodeURIComponent

await run(`inkstand://write?auth-token=secret&path=${enc('/Log.md')}&mode=add&text=${enc('Second entry.')}&add-padding=paragraph&author=${enc('ChatGPT <chat.openai.com>')}`)
let file = readFileSync(join(lib, 'Log.md'), 'utf8')
check('write add appends a paragraph', file.startsWith('# Log\n\nFirst entry.\n\nSecond entry.\n'), file)
check('write credits the author', /@ChatGPT \[ai\]: 21-34/.test(file), file)

await run(`inkstand://write?auth-token=secret&path=${enc('/Log.md')}&mode=patch&text=${enc('# Log\n\nFirst entry, revised.\n\nSecond entry.\n')}&author=Editor`)
file = readFileSync(join(lib, 'Log.md'), 'utf8')
check('write patch applies edits and keeps earlier credit', file.includes('First entry, revised.') && /@ChatGPT \[ai\]: 30-43/.test(file) && /@Editor \[human\]: 18-27/.test(file), file)

await run(`inkstand://write?auth-token=wrong&path=${enc('/Log.md')}&text=x&mode=replace&x-error=${enc('cb://err')}`)
const err = await opened()
check('wrong token is refused', readFileSync(join(lib, 'Log.md'), 'utf8').includes('revised') && err[0]?.startsWith('cb://err') && err[0].includes('auth-token'), err)

await run(`inkstand://x-callback-url/read?auth-token=secret&path=${enc('/Log.md')}&x-success=${enc('cb://ok')}`)
const ok = new URL((await opened())[0])
check('read returns text without the authorship block', ok.searchParams.get('path') === '/Log.md' && ok.searchParams.get('text').startsWith('# Log') && !ok.searchParams.get('text').includes('Authorship'), ok.toString())

await run(`inkstand://write?auth-token=secret&path=${enc('/../../escape.md')}&text=x&x-error=${enc('cb://err')}`)
check('paths cannot escape the library', !existsSync(join(lib, '../../escape.md')) && (await opened())[0]?.includes('Unknown'), null)

await run(`inkstand://new?path=${enc('/Inbox/')}&text=${enc('# Groceries\n\nmilk')}`)
await win.waitForTimeout(800)
check('new creates a named file and opens it', existsSync(join(lib, 'Inbox/Groceries.md')) && (await win.evaluate(() => window.fw.path))?.endsWith('Inbox/Groceries.md'), await win.evaluate(() => window.fw.path))

await run(`inkstand://open?path=${enc('/Log.md')}`)
await win.waitForTimeout(800)
check('open opens the document', (await win.evaluate(() => window.fw.path))?.endsWith('/Log.md'), await win.evaluate(() => window.fw.path))
check('authorship from the file is shown', (await win.evaluate(() => window.fw.editor.spans.length)) >= 2, await win.evaluate(() => window.fw.editor.spans))

await run(`inkstand://version?x-success=${enc('cb://v')}`)
check('version', new URL((await opened())[0]).searchParams.get('scheme-version') === '6', null)

app.close().catch(() => {})
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)

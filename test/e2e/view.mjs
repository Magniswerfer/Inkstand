// Preview modes and zoom, speaking time. Headless; never starts speech (it would be audible).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? tmpdir()
const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
writeFileSync(join(lib, 'Talk.md'), '# A Talk\n\n' + 'Words worth saying out loud, one after another. '.repeat(40) + '\n')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib], showSidebar: false }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1300, height: 820 })
await win.waitForTimeout(1200)
let failed = 0
const check = (label, ok, got) => {
  if (!ok) failed++
  console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : JSON.stringify(got))
}
await win.evaluate((p) => window.fw.open(p), join(lib, 'Talk.md'))

await win.evaluate(() => window.fw.run('fullPreview'))
await win.waitForTimeout(1200)
check('full preview hides the editor', await win.evaluate(() => getComputedStyle(document.getElementById('editor')).display === 'none' && getComputedStyle(document.getElementById('preview')).display !== 'none'), null)
await win.evaluate(() => window.fw.run('fitPage'))
await win.waitForTimeout(1500)
const zoom = await win.evaluate(() => document.querySelector('#preview iframe').contentDocument.documentElement.style.zoom)
check('fit page scales the sheet', Number(zoom) > 0.2 && Number(zoom) < 1, zoom)
await win.screenshot({ path: join(out, 'view-fitpage.png') })
await win.evaluate(() => window.fw.run('fitWidth'))
await win.waitForTimeout(800)
check('fit width clears the zoom', (await win.evaluate(() => document.querySelector('#preview iframe').contentDocument.documentElement.style.zoom)) === '', null)
await win.evaluate(() => window.fw.run('fullPreview'))
await win.waitForTimeout(300)
check('back to split', await win.evaluate(() => getComputedStyle(document.getElementById('editor')).display !== 'none'), null)
await win.evaluate(() => window.fw.run('reloadPreview'))

await win.evaluate(() => window.fw.set({ statMetric: 'speakingTime' }))
await win.waitForTimeout(300)
check('speaking time in status bar', /speaking$/.test(await win.textContent('.st-metric')), await win.textContent('.st-metric'))

app.close().catch(() => {})
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)

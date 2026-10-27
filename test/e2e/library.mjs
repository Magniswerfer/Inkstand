// Library: two columns, sort, filter, smart folders, move, get info. Headless.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? tmpdir()
const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
mkdirSync(join(lib, 'Notes'))
mkdirSync(join(lib, 'Archive'))
const docs = {
  'Hello.md': '# Visit Aarhus Rapport\n\nCreative Oak notes from the trip. #travel\n',
  'Groceries.md': 'Groceries\n\n- [ ] milk\n- [x] bread\n',
  'Notes/Ideas.md': '# Ideas\n\nTime travel and outer space. #ideas\n',
  'Notes/Old.txt': 'An old plain text file.\n'
}
for (const [p, t] of Object.entries(docs)) writeFileSync(join(lib, p), t)
const old = new Date('2020-01-01')
utimesSync(join(lib, 'Notes/Old.txt'), old, old)
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib] }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1400, height: 860 })
await win.waitForTimeout(1500)
let failed = 0
const check = (label, ok, got) => {
  if (!ok) failed++
  console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : JSON.stringify(got))
}
const names = () => win.$$eval('.sb-browser .sb-item .name', (els) => els.map((e) => e.textContent))

await win.evaluate((p) => window.fw.open(p), join(lib, 'Hello.md'))
await win.waitForTimeout(500)
await win.screenshot({ path: join(out, 'lib-1.png') })
check('organizer sections', (await win.$$eval('.sb-organizer .sb-section', (els) => els.map((e) => e.textContent.replace('+', '')))).join() === 'Locations,Favorites,Smart Folders,Hashtags', await win.$$eval('.sb-organizer .sb-section', (els) => els.map((e) => e.textContent)))
check('hashtags listed', (await win.$$eval('.sb-organizer .sb-nav .name', (els) => els.map((e) => e.textContent))).includes('travel'), null)
check('folders first, then files', (await names()).slice(0, 2).sort().join() === 'Archive,Notes', await names())

await win.evaluate(() => window.fw.set({ librarySort: 'name' }))
await win.waitForTimeout(300)
check('sort by name', (await names()).join() === 'Archive,Notes,Groceries,Hello', await names())

await win.fill('.sb-filter-input', 'aarhus')
await win.waitForTimeout(200)
check('filter by text', (await names()).join() === 'Hello', await names())
await win.fill('.sb-filter-input', 'name:groc')
await win.waitForTimeout(200)
check('filter by name', (await names()).join() === 'Groceries', await names())
await win.fill('.sb-filter-input', '')

const smart = await win.evaluate((roots) =>
  window.api.smartFolder(roots, { id: 'x', name: 'x', query: '', match: 'all', rules: [{ field: 'ancestorPath', op: 'is', value: '/Notes' }, { field: 'dateModified', op: 'notInPast', value: '30' }] }), [lib])
check('smart folder rules (path + date)', smart.map((h) => h.name).join() === 'Old.txt', smart.map((h) => h.name))
const search = await win.evaluate((roots) => window.api.search(roots, 'NEAR(time space) OR #travel'), [lib])
check('search language in main', search.map((h) => h.name).sort().join() === 'Hello.md,Ideas.md', search.map((h) => h.name))

// Multi-select with ⌘-click, then move both into Archive.
await win.click('.sb-browser .sb-item[data-path$="Groceries.md"]', { modifiers: ['Meta'] })
await win.click('.sb-browser .sb-item[data-path$="Hello.md"]', { modifiers: ['Meta'] })
check('multi-select', (await win.$$('.sb-browser .sb-item.selected')).length === 2, null)
await win.evaluate((args) => window.fw.library.moveAll(args.paths, args.to), { paths: [join(lib, 'Groceries.md'), join(lib, 'Hello.md')], to: join(lib, 'Archive') })
await win.waitForTimeout(500)
const after = await win.evaluate(() => window.fw.path)
check('move keeps the open document open', existsSync(join(lib, 'Archive/Hello.md')) && !existsSync(join(lib, 'Hello.md')) && after?.endsWith('Archive/Hello.md'), after)

await win.evaluate(() => window.fw.run('getInfo'))
await win.waitForTimeout(300)
const info = await win.$$eval('.fw-info th', (els) => els.map((e) => e.textContent))
check('get info shows words and speaking time', info.includes('Words') && info.includes('Speaking time'), info)
await win.screenshot({ path: join(out, 'lib-2-info.png') })
await win.keyboard.press('Escape')

await win.evaluate(() => window.fw.library.newSmartFolder('#ideas'))
await win.waitForTimeout(600)
await win.screenshot({ path: join(out, 'lib-3-smart.png') })
check('smart folder editor counts matches', /1 matching item/.test(await win.textContent('.fw-modal')), await win.textContent('.fw-modal .pf-intro'))

app.close().catch(() => {})
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)

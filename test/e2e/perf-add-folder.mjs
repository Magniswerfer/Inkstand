// Times adding a library folder (minus the native folder picker), headless.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
for (let i = 0; i < 300; i++) writeFileSync(join(lib, `Note ${i}.md`), `# Note ${i}\n\nSome text #tag${i % 7}.\n`)
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [] }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.waitForTimeout(1500)
for (let run = 0; run < 3; run++) {
  const ms = await win.evaluate(async (dir) => {
    const t0 = performance.now()
    await window.fw.set({ libraryLocations: [dir] })
    window.fw.library.showFolder(dir)
    while (!document.querySelector('.sb-file')) await new Promise((r) => setTimeout(r, 5))
    const t1 = performance.now()
    await window.fw.set({ libraryLocations: [] })
    window.fw.library.showFolder(dir)
    await new Promise((r) => setTimeout(r, 300))
    return Math.round(t1 - t0)
  }, lib)
  console.log(`add folder → list shown: ${ms} ms`)
}
const setMs = await win.evaluate(async () => {
  const t0 = performance.now()
  for (let i = 0; i < 5; i++) await window.fw.set({ wordsPerMinute: 230 + i })
  return Math.round((performance.now() - t0) / 5)
})
console.log(`plain settings change round trip: ${setMs} ms`)
app.close().catch(() => {})
process.exit(0)

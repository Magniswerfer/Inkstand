// Typewriter mode must keep the caret at the vertical centre after every keystroke, including Return.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'fw-user-'))
const lib = mkdtempSync(join(tmpdir(), 'fw-lib-'))
writeFileSync(join(lib, 'Draft.md'), '# Draft\n\n' + 'A line of text.\n\n'.repeat(30))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib], recent: [join(lib, 'Draft.md')], typewriter: true }))

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, FW_HEADLESS: '1' } })
const win = await app.firstWindow()
await win.waitForTimeout(1500)

// Distance of the caret from the scroller's vertical centre, in px, once scrolling has settled.
const offset = () =>
  win.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = window.fw.editor.view
            const caret = v.coordsAtPos(v.state.selection.main.head)
            const box = v.scrollDOM.getBoundingClientRect()
            resolve(Math.round((caret.top + caret.bottom) / 2 - (box.top + box.height / 2)))
          })
        )
      )
  )

const start = process.argv[2] === 'end' ? 'end' : 'middle'
await win.evaluate((where) => {
  const v = window.fw.editor.view
  v.focus()
  v.dispatch({ selection: { anchor: where === 'end' ? v.state.doc.length : 20 } })
}, start)
await win.waitForTimeout(300)
console.log('starting at', start, 'offset', await offset())
let worst = 0
const steps = [['Enter'], ['Enter'], ['type', 'Hello'], ['Enter'], ['Enter'], ['ArrowUp'], ['ArrowDown'], ['Backspace'], ['Backspace']]
for (const [kind, arg] of steps) {
  if (kind === 'type') await win.keyboard.type(arg)
  else await win.keyboard.press(kind)
  const o = await offset()
  worst = Math.max(worst, Math.abs(o))
  const dbg = process.env.DEBUG ? await win.evaluate(() => {
    const v = window.fw.editor.view, d = v.scrollDOM, c = v.contentDOM
    return `scrollTop=${Math.round(d.scrollTop)} max=${d.scrollHeight - d.clientHeight} padBottom=${getComputedStyle(c).paddingBottom} lines=${v.state.doc.lines}`
  }) : ''
  console.log(`${kind.padEnd(9)} ${arg ?? ''} offset ${o}px ${dbg}`)
}
app.close().catch(() => {})
console.log(worst <= 20 ? 'PASS' : `FAIL (worst ${worst}px)`)
process.exit(worst <= 20 ? 0 : 1)

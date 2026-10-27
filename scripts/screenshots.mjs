// Takes the README screenshots off-screen, then frames them as macOS windows.
// Usage: npm run build && node scripts/screenshots.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve('docs/screenshots')
const raw = mkdtempSync(join(tmpdir(), 'ink-shots-'))
mkdirSync(out, { recursive: true })
const W = 1440
const H = 900

async function shot(name, settings, setup) {
  const userData = mkdtempSync(join(tmpdir(), 'ink-user-'))
  const lib = join(mkdtempSync(join(tmpdir(), 'ink-lib-')), 'Writing')
  cpSync('scripts/sample-library', lib, { recursive: true })
  // Fresh copies all say "Just now"; give the library a believable history.
  const hours = { 'Essays/On Writing Every Day.md': 1.5, 'Essays/The Case for Plain Text.md': 26, 'Draft Talk.md': 4, 'Ideas.md': 30, 'Reading List.md': 80, 'Field Notes/Copenhagen.md': 52, 'Field Notes/Aarhus.md': 140 }
  for (const [rel, h] of Object.entries(hours)) {
    const t = new Date(Date.now() - h * 3600_000)
    utimesSync(join(lib, rel), t, t)
  }
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ libraryLocations: [lib], ...settings }))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, '--force-device-scale-factor=2'], env: { ...process.env, FW_HEADLESS: '1' } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: W, height: H })
  await win.waitForTimeout(1200)
  await setup(win, lib)
  await win.waitForTimeout(1200)
  await win.mouse.move(W / 2, H / 2)
  await win.evaluate(() => document.body.classList.remove('typing'))
  await win.screenshot({ path: join(raw, name + '.png') })
  await app.close().catch(() => {})
  frame(name)
}

/** Draws the screenshot inside a macOS-style window with a soft shadow on a transparent background. */
function frame(name) {
  const html = join(raw, name + '-frame.html')
  writeFileSync(
    html,
    `<!doctype html><html><head><style>
      html, body { margin: 0; background: transparent; }
      .win { position: absolute; left: 60px; top: 50px; width: ${W}px; height: ${H}px; border-radius: 12px; overflow: hidden;
             box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 22px 60px rgba(0,0,0,.28), 0 4px 14px rgba(0,0,0,.12); }
      .win img { display: block; width: ${W}px; height: ${H}px; }
      .lights { position: absolute; left: 20px; top: 20px; display: flex; gap: 8px; }
      .lights span { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
    </style></head><body><div class="win"><img src="${name}.png"><div class="lights">
      <span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span>
    </div></div></body></html>`
  )
  execFileSync('npx', ['electron', 'scripts/render.cjs', html, join(out, name + '.png'), String(W + 120), String(H + 130), '2'])
}

const open = (win, lib, rel) => win.evaluate((p) => window.fw.open(p), join(lib, rel))
const caretAfter = (win, text, offset = 0) =>
  win.evaluate(([t, o]) => {
    const v = window.fw.editor.view
    v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf(t) + t.length + o } })
    v.focus()
  }, [text, offset])

await shot('library', { theme: 'light' }, async (win, lib) => {
  await open(win, lib, 'Essays/On Writing Every Day.md')
  await win.evaluate((p) => window.fw.library.showFolder(p), join(lib, 'Essays'))
  await caretAfter(win, 'cost of starting.')
})

await shot('focus', { theme: 'dark', showSidebar: false, focusMode: 'sentence', typewriter: true }, async (win, lib) => {
  await open(win, lib, 'Essays/On Writing Every Day.md')
  await caretAfter(win, 'It has to exist.', -6)
})

await shot('preview', { theme: 'light', showSidebar: false, showPreview: true, previewTemplate: 'classic' }, async (win, lib) => {
  await open(win, lib, 'Essays/On Writing Every Day.md')
  await caretAfter(win, '# On Writing Every Day')
})

await shot(
  'syntax',
  { theme: 'light', showSidebar: false, syntax: { adjectives: true, nouns: true, adverbs: true, verbs: true, conjunctions: true }, styleCheck: { fillers: true, cliches: true, redundancies: true, custom: [], ignored: [] } },
  async (win, lib) => {
    await open(win, lib, 'Draft Talk.md')
    await caretAfter(win, '# Notes for a Talk')
  }
)

await shot('authorship', { theme: 'light', showSidebar: false, authorship: { enabled: true, showBorrowed: true, author: '', pasteAuthor: 'pasted', storeInFile: true, authors: [{ id: 'ai', name: 'ChatGPT', kind: 'ai', color: '#7b3fb0' }, { id: 'pasted', name: 'Pasted', kind: 'reference', color: '#8a8f99' }] } }, async (win, lib) => {
  await open(win, lib, 'Draft Talk.md')
  await win.evaluate(() => {
    const v = window.fw.editor.view
    const doc = v.state.doc.toString()
    const s = 'A careful writer reads every sentence aloud and cuts the words that only fill space.'
    const at = doc.indexOf(s)
    window.fw.editor.view.dispatch({ selection: { anchor: at, head: at + s.length } })
  })
  await win.evaluate(() => window.fw.run('markAs', 'ai'))
  await caretAfter(win, '# Notes for a Talk')
  await win.evaluate(() => window.fw.status.update())
})

console.log('Screenshots written to', out)

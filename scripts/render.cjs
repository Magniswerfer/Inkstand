// Renders an HTML file to a PNG off-screen with Electron (no window, no Dock icon).
// Usage: electron scripts/render.cjs <input.html> <output.png> <width> <height> [deviceScale]
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

// Arguments follow this script's path; Electron may put its own switches before it.
const at = process.argv.findIndex((a) => a.endsWith('render.cjs'))
const [input, output, w, h, scale = '2'] = process.argv.slice(at + 1)
app.commandLine.appendSwitch('force-device-scale-factor', scale)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Number(w), height: Number(h), useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await win.loadFile(resolve(input))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))')
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: Number(w), height: Number(h) })
  writeFileSync(resolve(output), image.toPNG())
  app.exit(0)
})

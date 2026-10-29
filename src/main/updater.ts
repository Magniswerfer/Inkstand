// Automatic updates from the project's GitHub releases.
//
// Packaged builds check shortly after launch and then every few hours, download a newer release in
// the background and install it when you quit (or right away, if you choose Restart). The
// update feed is the latest-*.yml file electron-builder publishes next to the downloads, so only
// published (not draft) releases are offered. macOS needs the signed .zip; Windows the installer;
// Linux the AppImage. A .deb install can't replace itself, so it only points to the download page.
import { app, BrowserWindow, dialog, shell } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { getSettings, onSettingsChanged } from './settings'

const { autoUpdater } = electronUpdater

const RELEASES = 'https://github.com/Magniswerfer/foss-write/releases/latest'
const FIRST_CHECK = 10_000
const INTERVAL = 6 * 60 * 60 * 1000

/** Whether this build can install an update by itself. */
const canInstall = () => process.platform !== 'linux' || Boolean(process.env.APPIMAGE)

let first: NodeJS.Timeout | undefined
let timer: NodeJS.Timeout | undefined
let checking = false
let ready: UpdateInfo | null = null
/** Set while a check from the menu runs, so its outcome is reported even when there's nothing new. */
let manual = false

const parent = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

function message(opts: Electron.MessageBoxOptions) {
  const win = parent()
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
}

async function check() {
  if (checking) return
  checking = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    if (manual) message({ type: 'warning', message: 'Couldn’t check for updates', detail: String((err as Error)?.message ?? err) })
  } finally {
    checking = false
    manual = false
  }
}

function schedule() {
  clearTimeout(first)
  clearInterval(timer)
  if (!getSettings().autoUpdate) return
  first = setTimeout(check, FIRST_CHECK)
  timer = setInterval(check, INTERVAL)
}

export function initUpdater() {
  if (!app.isPackaged) return
  // Set here rather than read from app-update.yml, which only publishing builds write.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'Magniswerfer', repo: 'foss-write' })
  autoUpdater.autoDownload = canInstall()
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (canInstall()) {
      if (manual) message({ type: 'info', message: `Downloading Inkstand ${info.version}`, detail: 'You’ll be asked to restart when it’s ready.' })
      return
    }
    message({
      type: 'info',
      message: `Inkstand ${info.version} is available`,
      detail: `You have ${app.getVersion()}. Download the new version from the releases page.`,
      buttons: ['Open Download Page', 'Later'],
      defaultId: 0
    }).then((r) => {
      if (r.response === 0) shell.openExternal(RELEASES)
    })
  })

  // A failed background check or download just waits for the next one; without a listener the error would crash.
  autoUpdater.on('error', (err) => console.warn('Update failed:', err?.message ?? err))

  autoUpdater.on('update-not-available', () => {
    if (manual) message({ type: 'info', message: 'Inkstand is up to date', detail: `Version ${app.getVersion()} is the newest version.` })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (ready?.version === info.version) return
    ready = info
    offerRestart(info)
  })

  onSettingsChanged((next, prev) => {
    if (next.autoUpdate !== prev.autoUpdate) schedule()
  })
  schedule()
}

async function offerRestart(info: UpdateInfo) {
  const r = await message({
    type: 'info',
    message: `Inkstand ${info.version} is ready to install`,
    detail: 'Restart now to update, or keep writing and it installs the next time you quit.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall())
}

/** Check for Updates… in the menu. */
export function checkForUpdatesNow() {
  if (!app.isPackaged) {
    message({ type: 'info', message: 'Updates are off in development builds', detail: 'Run a packaged build to check for updates.' })
    return
  }
  if (ready) {
    offerRestart(ready)
    return
  }
  manual = true
  check()
}

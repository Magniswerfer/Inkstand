import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, ShareMenu, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cpSync, existsSync } from 'node:fs'
import type { Authorship, PdfOptions, PublishAccount, PublishRequest, Settings, SmartFolder } from '@shared/types'
import { isTextFile } from '@shared/text'
import { addRecent, encryptSecret, getSettings, onSettingsChanged, publicSettings, setSettings } from './settings'
import { LibraryWatcher, listAllFiles, listDir, search, smartFolder, stat, tags, walkAll } from './library'
import { importTemplate, listTemplates, removeTemplate, templateFile, userTemplatesDir } from './templates'
import { getAuthorship, listVersions, moveVersions, readVersion, saveVersion, setAuthorship } from './versions'
import { publish } from './publish'
import { resourcePath } from './paths'
import { handleUrl, SCHEME, type UrlHost } from './urlcommands'
import { buildMenu } from './menu'

// Inkstand was called FOSS Write before its first release: carry its data over once.
migrateUserData()

protocol.registerSchemesAsPrivileged([
  { scheme: 'fw-template', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'fw-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'fw-vendor', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

/**
 * Test-only: FW_HEADLESS=1 renders windows off-screen, never shows them and keeps the app out of
 * the Dock, so end-to-end tests can run without taking over the screen.
 */
const headless = process.env.FW_HEADLESS === '1'
if (headless && process.platform === 'darwin') app.setActivationPolicy('prohibited')

interface DocState {
  path: string | null
  dirty: boolean
  title: string
  fileWatcher?: FSWatcher
  libraryWatcher?: LibraryWatcher
}

const docs = new Map<number, DocState>()
const pendingOpen: string[] = []

function state(wc: WebContents): DocState {
  let s = docs.get(wc.id)
  if (!s) docs.set(wc.id, (s = { path: null, dirty: false, title: 'Untitled' }))
  return s
}

function createWindow(path?: string, restore = false) {
  const focused = BrowserWindow.getFocusedWindow()
  const [x, y] = focused ? focused.getPosition().map((n) => n + 24) : [undefined, undefined]
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    x,
    y,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: 'Untitled',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    tabbingIdentifier: 'inkstand',
    ...(process.platform === 'linux' ? { icon: appIcon() } : {}),
    // macOS: translucent sidebar. Elsewhere an opaque background avoids a white flash.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff' }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: true,
      offscreen: headless,
      backgroundThrottling: !headless
    }
  })
  const wc = win.webContents
  const id = wc.id
  state(wc)

  if (!headless) win.once('ready-to-show', () => win.show())
  wc.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) {
      e.preventDefault()
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url)
    }
  })
  wc.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => wc.replaceMisspelling(s) })
      if (!params.dictionarySuggestions.length) items.push({ label: 'No Guesses Found', enabled: false })
      items.push(
        { label: 'Learn Spelling', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' }
      )
    }
    if (params.selectionText.trim()) {
      const q = encodeURIComponent(params.selectionText.trim().slice(0, 200))
      items.push(
        { label: 'Look Up in Dictionary', visible: process.platform === 'darwin', click: () => wc.showDefinitionForSelection() },
        { label: 'Search the Web', click: () => shell.openExternal(`https://duckduckgo.com/?q=${q}`) },
        { type: 'separator' }
      )
    }
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  win.on('close', async (e) => {
    const s = docs.get(id)
    if (!s?.dirty) return
    e.preventDefault()
    const choice = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `Save changes to “${s.title}”?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Cancel', 'Don’t Save'],
      defaultId: 0,
      cancelId: 1
    })
    if (choice.response === 1) return
    if (choice.response === 0) {
      wc.send('menu', 'saveAndClose')
      return
    }
    s.dirty = false
    win.destroy()
  })
  win.on('closed', () => {
    const s = docs.get(id)
    s?.fileWatcher?.close()
    s?.libraryWatcher?.close()
    docs.delete(id)
  })

  // The renderer reads what to open from the hash, so it never races an IPC message.
  const hash = path ? 'open=' + encodeURIComponent(path) : restore ? 'restore' : ''
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? '#' + hash : ''))
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
  return win
}

function openPath(path: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (docs.get(win.webContents.id)?.path === path) {
      win.focus()
      return
    }
  }
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const s = target && docs.get(target.webContents.id)
  if (target && s && !s.path && !s.dirty) {
    target.webContents.send('open-file', path)
    target.focus()
  } else createWindow(path)
}

const pendingUrls: string[] = []
const urlHost: UrlHost = {
  // Like iA Writer: open in the current window unless new-window=true.
  open: (path, newWindow) => {
    const existing = BrowserWindow.getAllWindows().find((w) => docs.get(w.webContents.id)?.path === path)
    if (existing) return existing.focus()
    const win = !newWindow && (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])
    if (!win) return createWindow(path)
    win.webContents.send('open-file', path)
    win.focus()
  },
  newDocument: (newWindow) => {
    const win = !newWindow && (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])
    if (win) {
      win.webContents.send('menu', 'new')
      win.focus()
    } else createWindow()
  },
  quickSearch: (query) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? createWindow()
    const send = () => win.webContents.send('menu', 'quickOpen', query)
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 300))
    else send()
    win.focus()
  }
}

app.on('open-url', (e, url) => {
  e.preventDefault()
  if (app.isReady()) handleUrl(url, urlHost)
  else pendingUrls.push(url)
})

app.on('open-file', (e, path) => {
  e.preventDefault()
  if (app.isReady()) openPath(path)
  else pendingOpen.push(path)
})

// Second launches (Windows/Linux file associations, CLI) hand their files to us.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', (_e, argv) => {
  const urls = argv.filter((a) => a.startsWith(SCHEME + '://'))
  urls.forEach((u) => handleUrl(u, urlHost))
  const files = argv.slice(1).filter((a) => isTextFile(a))
  if (files.length) files.forEach(openPath)
  else if (!urls.length) createWindow()
})

const handle = <A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R) =>
  ipcMain.handle(channel, (e, ...args) => fn(e, ...(args as A)))

/** The 1024px app icon: bundled as a resource when packaged, from build/ in development. */
function appIcon() {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
}

function migrateUserData() {
  const from = join(app.getPath('appData'), 'FOSS Write')
  const to = app.getPath('userData')
  if (!existsSync(join(from, 'settings.json')) || existsSync(join(to, 'settings.json'))) return
  for (const item of ['settings.json', 'versions', 'authorship', 'templates']) {
    if (existsSync(join(from, item))) cpSync(join(from, item), join(to, item), { recursive: true })
  }
}

/** Serves a local file to the renderer; fonts loaded from CSS need a CORS header. */
async function serveFile(path: string | null): Promise<Response> {
  if (!path) return new Response('Not found', { status: 404 })
  const res = await net.fetch(pathToFileURL(path).toString()).catch(() => null)
  if (!res) return new Response('Not found', { status: 404 })
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, { status: res.status, headers })
}

async function renderPdfWindow(opts: PdfOptions) {
  const file = join(tmpdir(), `inkstand-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  // A <base> makes the template's relative stylesheet links resolve against the template folder.
  const html = opts.html.replace(/<head([^>]*)>/i, `<head$1><base href="${opts.baseUrl}">`)
  await fs.writeFile(file, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  await win.loadFile(file)
  await new Promise((r) => setTimeout(r, 300)) // Let web fonts settle.
  fs.rm(file, { force: true })
  return win
}

function headerFooter(html: string, height: number, sideMarginMm: number) {
  if (!html.trim()) return '<span></span>'
  return `<div style="width:100%;height:${height}px;font-size:9px;font-family:-apple-system,'Helvetica Neue',sans-serif;color:#777;padding:0 ${sideMarginMm}mm;display:flex;align-items:center;-webkit-print-color-adjust:exact">${html}</div>`
}

app.whenReady().then(async () => {
  app.setName('Inkstand')
  app.setAboutPanelOptions({
    applicationName: 'Inkstand',
    applicationVersion: app.getVersion(),
    copyright: 'Free software under the GNU AGPL v3',
    website: 'https://github.com/Magniswerfer/foss-write',
    iconPath: appIcon()
  })
  // Packaged builds take their icon from the bundle; show it in development too.
  if (!app.isPackaged && process.platform === 'darwin' && !headless) app.dock?.setIcon(appIcon())
  protocol.handle('fw-template', (req) => {
    const url = new URL(req.url)
    return serveFile(templateFile(url.hostname, decodeURIComponent(url.pathname.slice(1))))
  })
  protocol.handle('fw-vendor', (req) => {
    const url = new URL(req.url)
    const root = url.hostname === 'katex' ? (app.isPackaged ? resourcePath('vendor', 'katex') : join(app.getAppPath(), 'node_modules', 'katex', 'dist')) : resourcePath('app')
    const file = join(root, decodeURIComponent(url.pathname))
    return serveFile(file.startsWith(root) ? file : null)
  })
  protocol.handle('fw-file', (req) => {
    const url = new URL(req.url)
    return serveFile(decodeURIComponent(url.pathname))
  })

  handle('settings:get', () => publicSettings())
  handle('settings:set', (_e, patch: Partial<Settings>) => {
    // Accounts are only changed through accounts:save so secrets can't be overwritten with the mask.
    const { publishAccounts, ...rest } = patch
    if (publishAccounts) {
      const keep = new Set(publishAccounts.map((a) => a.id))
      return setSettings({ ...rest, publishAccounts: getSettings().publishAccounts.filter((a) => keep.has(a.id)) })
    }
    return setSettings(rest)
  })
  handle('accounts:save', (_e, account: Omit<PublishAccount, 'secret'> & { secret?: string }) => {
    const accounts = getSettings().publishAccounts
    const existing = accounts.find((a) => a.id === account.id)
    const secret = account.secret ? encryptSecret(account.secret) : existing?.secret ?? ''
    const next = { ...account, secret } as PublishAccount
    return setSettings({ publishAccounts: existing ? accounts.map((a) => (a.id === account.id ? next : a)) : [...accounts, next] })
  })
  handle('publish', (_e, req: PublishRequest) => publish(req))

  handle('fs:read', (_e, path: string) => fs.readFile(path, 'utf8'))
  handle('fs:readBase64', async (_e, path: string) => (await fs.readFile(path)).toString('base64'))
  handle('fs:write', async (e, path: string, content: string) => {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, content, 'utf8')
    if (state(e.sender).path === path) addRecent(path)
    return { mtime: (await fs.stat(path)).mtimeMs }
  })
  handle('fs:writeBinary', async (_e, path: string, data: ArrayBuffer) => {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, Buffer.from(data))
  })
  handle('fs:exists', async (_e, path: string) => !!(await stat(path)))
  handle('fs:stat', (_e, path: string) => stat(path))
  handle('fs:listDir', (_e, dir: string) => listDir(dir))
  handle('fs:listAll', (_e, root: string) => listAllFiles(root, true))
  handle('fs:listFolders', async (_e, root: string) => [root, ...(await walkAll(root)).filter((e) => e.isDir).map((e) => e.path)])
  handle('fs:mkdir', async (_e, path: string) => {
    await fs.mkdir(path, { recursive: true })
  })
  handle('fs:rename', async (_e, from: string, to: string) => {
    if (from !== to && (await stat(to))) throw new Error(`“${to}” already exists.`)
    await fs.rename(from, to)
    await moveVersions(from, to)
  })
  handle('fs:copy', (_e, from: string, to: string) => fs.copyFile(from, to))
  handle('fs:trash', (_e, path: string) => shell.trashItem(path))
  handle('fs:reveal', (_e, path: string) => shell.showItemInFolder(path))
  handle('shell:open', (_e, url: string) => {
    if (/^(https?|mailto):/.test(url)) return shell.openExternal(url)
    return shell.openPath(url).then(() => undefined)
  })
  handle('fs:search', (_e, roots: string[], q: string) => search(roots, q))
  handle('fs:smart', (_e, roots: string[], folder: SmartFolder) => smartFolder(roots, folder))
  handle('fs:tags', (_e, roots: string[]) => tags(roots))
  handle('fs:watchFile', (e, path: string | null) => {
    const s = state(e.sender)
    s.fileWatcher?.close()
    s.fileWatcher = undefined
    if (!path) return
    try {
      s.fileWatcher = watch(path, (kind) => e.sender.send('file-changed', { path, kind }))
      s.fileWatcher.on('error', () => {})
    } catch {
      // File may not exist yet.
    }
  })
  handle('fs:watchLibrary', (e, dirs: string[]) => {
    const s = state(e.sender)
    s.libraryWatcher ??= new LibraryWatcher((dir) => !e.sender.isDestroyed() && e.sender.send('library-changed', dir))
    s.libraryWatcher.set(dirs)
  })

  handle('dialog:open', async (e, opts: { directory?: boolean; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: opts.directory ? ['openDirectory', 'createDirectory'] : ['openFile', 'multiSelections'],
      filters: opts.filters
    })
    return r.canceled ? null : r.filePaths
  })
  handle('dialog:save', async (e, opts: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, opts)
    return r.canceled ? null : r.filePath
  })
  handle('dialog:confirm', async (e, opts: { message: string; detail?: string; buttons: string[] }) => {
    const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender)!, { ...opts, type: 'question', cancelId: opts.buttons.length - 1 })
    return r.response
  })

  ipcMain.on('doc:state', (e, next: { path: string | null; dirty: boolean; title: string }) => {
    const s = state(e.sender)
    Object.assign(s, next)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.setTitle(next.title)
    win.setDocumentEdited(next.dirty)
    if (process.platform === 'darwin') win.setRepresentedFilename(next.path ?? '')
  })
  handle('window:new', (_e, path?: string) => {
    createWindow(path)
  })

  handle('templates:list', () => listTemplates())
  handle('templates:import', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
      message: 'Choose an iA Writer .iatemplate bundle or a folder containing template.json',
      properties: ['openFile', 'openDirectory', 'treatPackageAsDirectory'],
      filters: [{ name: 'Templates', extensions: ['iatemplate'] }]
    })
    if (r.canceled) return null
    let src = r.filePaths[0]
    // Picking a file inside a bundle selects the bundle.
    const bundle = src.match(/^(.*?\.iatemplate)(\/|$)/)
    if (bundle) src = bundle[1]
    const t = await importTemplate(src)
    if (!t) throw new Error('That folder does not look like a template.')
    return t
  })
  handle('templates:remove', (_e, id: string) => removeTemplate(id))
  handle('templates:reveal', async () => {
    await fs.mkdir(userTemplatesDir(), { recursive: true })
    shell.openPath(userTemplatesDir())
  })

  handle('export:pdf', async (_e, opts: PdfOptions, target: string) => {
    const win = await renderPdfWindow(opts)
    try {
      const { page } = opts
      const header = page.header ? opts.headerHtml : ''
      const footer = page.footer ? opts.footerHtml : ''
      const inch = (mm: number) => mm / 25.4
      const pdf = await win.webContents.printToPDF({
        pageSize: opts.paper,
        landscape: page.orientation === 'landscape',
        printBackground: true,
        displayHeaderFooter: !!(header || footer),
        headerTemplate: headerFooter(header, opts.headerHeight, page.margins.left),
        footerTemplate: headerFooter(footer, opts.footerHeight, page.margins.left),
        margins: {
          top: Math.max(inch(page.margins.top), header ? opts.headerHeight / 96 : 0),
          bottom: Math.max(inch(page.margins.bottom), footer ? opts.footerHeight / 96 : 0),
          left: inch(page.margins.left),
          right: inch(page.margins.right)
        }
      })
      await fs.writeFile(target, pdf)
    } finally {
      win.destroy()
    }
  })
  handle('print', async (_e, opts: PdfOptions) => {
    const win = await renderPdfWindow(opts)
    const px = (mm: number) => Math.round((mm * 96) / 25.4)
    const { margins } = opts.page
    win.webContents.print(
      {
        printBackground: true,
        landscape: opts.page.orientation === 'landscape',
        pageSize: opts.paper,
        margins: { marginType: 'custom', top: px(margins.top), bottom: px(margins.bottom), left: px(margins.left), right: px(margins.right) }
      },
      () => win.destroy()
    )
  })
  handle('share', async (e, path: string) => {
    if (process.platform !== 'darwin') return shell.showItemInFolder(path)
    new ShareMenu({ filePaths: [path] }).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined })
  })
  handle('clipboard:rich', (_e, html: string, text: string) => clipboard.write({ html, text }))

  handle('versions:list', (_e, path: string) => listVersions(path))
  handle('versions:read', (_e, path: string, id: string) => readVersion(path, id))
  handle('versions:save', (_e, path: string, content: string, force: boolean, label?: string) => saveVersion(path, content, force, label))
  handle('versions:move', (_e, from: string, to: string) => moveVersions(from, to))
  handle('authorship:get', (_e, path: string) => getAuthorship(path))
  handle('authorship:set', (_e, path: string, a: Authorship) => setAuthorship(path, a))
  handle('spell:add', (e, word: string) => e.sender.session.addWordToSpellCheckerDictionary(word))

  // Native chrome (vibrancy, dialogs, menus) follows the app's theme setting.
  // Setting themeSource makes macOS redraw every window, so only do it when the theme changes.
  nativeTheme.themeSource = getSettings().theme
  onSettingsChanged((next, prev) => {
    if (next.theme !== prev.theme) nativeTheme.themeSource = next.theme
  })
  // Rebuilding the menu bar is slow on macOS; only do it when a menu checkmark or list changed.
  const MENU_KEYS: (keyof Settings)[] = [
    'recent', 'showSidebar', 'showOutline', 'showPreview', 'showStats', 'focusMode', 'typewriter', 'syntax',
    'styleCheck', 'theme', 'font', 'lineWidth', 'markup', 'spellcheck', 'smartQuotes', 'smartDashes', 'authorship',
    'showOrganizer', 'showSortBar', 'showFilterBar', 'librarySort', 'librarySortReverse', 'previewMode', 'previewZoom'
  ]
  buildMenu(openPath)
  let menuTimer: NodeJS.Timeout | undefined
  onSettingsChanged((next, prev) => {
    if (!MENU_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]))) return
    clearTimeout(menuTimer)
    menuTimer = setTimeout(() => buildMenu(openPath), 50)
  })

  // Tests drive URL commands directly instead of through the OS.
  if (headless) (globalThis as any).__fwHandleUrl = (url: string) => handleUrl(url, urlHost)
  // Packaged builds own the inkstand:// scheme; development runs never claim it.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)
  if (process.platform === 'darwin' && !headless) {
    app.dock?.setMenu(
      Menu.buildFromTemplate([
        { label: 'New Document', click: () => urlHost.newDocument(false) },
        { label: 'New Window', click: () => createWindow() }
      ])
    )
  }

  const argvFiles = process.argv.slice(1).filter((a) => isTextFile(a) && !a.startsWith('-'))
  const urls = [...pendingUrls, ...process.argv.filter((a) => a.startsWith(SCHEME + '://'))]
  const initial = [...pendingOpen, ...argvFiles]
  if (initial.length) initial.forEach((p) => createWindow(p))
  else createWindow(undefined, !urls.length)
  urls.forEach((u) => handleUrl(u, urlHost))

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

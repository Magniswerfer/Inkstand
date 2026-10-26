import type { DirEntry, Settings } from '@shared/types'
import { extractTags, extractTitle, fileNameFromTitle, isTextFile } from '@shared/text'
import { Editor } from './editor'
import { markBorrowed } from './editor/authorship'
import { insertCodeBlock, insertFootnote, insertLink, insertTable, insertText, setLinePrefix, tidyTable, toggleTask, toggleWrap } from './editor/format'
import type { LinkTarget } from './editor/markup'
import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands'
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { renderMarkdown, resolvePath, type RenderContext, type Rendered } from './markdown/render'
import { basename, debounce, dirname, stripExt } from './ui/dom'
import { prompt, toast } from './ui/overlay'
import { Library } from './ui/library'
import { Preview } from './ui/preview'
import { Outline } from './ui/outline'
import { StatusBar } from './ui/statusbar'
import { Palette } from './ui/palette'
import { openPreferences } from './ui/prefs'
import { openVersions } from './ui/versions'
import { openExport, quickExport, copyAs, exportTo } from './ui/export'
import { openPublish } from './ui/publish'
import { openCheatsheet, guideText } from './ui/help'
import { applyAppearance } from './appearance'

const api = window.api

export interface Command {
  id: string
  title: string
  run: (arg?: any) => unknown
  /** Hidden from the command palette. */
  hidden?: boolean
}

export class App {
  settings!: Settings
  editor!: Editor
  library!: Library
  preview!: Preview
  outline!: Outline
  status!: StatusBar
  palette!: Palette
  commands = new Map<string, Command>()

  path: string | null = null
  saved = ''
  /** Every text and asset file under the library locations (for wiki links, quick open, completion). */
  files: DirEntry[] = []
  tagList: string[] = []
  private saving: Promise<void> | null = null
  private lastVersionCheck = 0

  async init() {
    this.settings = await api.getSettings()
    applyAppearance(this.settings)
    const root = document.getElementById('app')!
    this.editor = new Editor(root.querySelector('#editor')!, this, this.settings)
    this.library = new Library(this, root.querySelector('#sidebar')!)
    this.preview = new Preview(this, root.querySelector('#preview')!)
    this.outline = new Outline(this, root.querySelector('#outline')!)
    this.status = new StatusBar(this, root.querySelector('#statusbar')!)
    this.palette = new Palette(this)
    this.registerCommands()
    this.applyLayout()

    api.onSettings((s) => this.onSettings(s))
    api.onMenu((cmd, arg) => this.run(cmd, arg))
    api.onOpenFile((p) => this.open(p))
    api.onFileChanged((e) => this.onExternalChange(e.path))
    api.onLibraryChanged(() => this.refreshFiles())
    document.querySelector('#titlebar .doc-title')!.addEventListener('click', () => this.run('rename'))
    for (const btn of document.querySelectorAll<HTMLElement>('#titlebar [data-cmd]')) btn.addEventListener('click', () => this.run(btn.dataset.cmd!))
    window.addEventListener('focus', () => this.refreshFiles())

    this.refreshFiles()
    const hash = new URLSearchParams(location.hash.slice(1))
    const restore = hash.has('restore') ? this.settings.recent[0] : null
    if (hash.get('open')) await this.open(hash.get('open')!)
    else if (restore && (await api.exists(restore))) await this.open(restore)
    else this.updateState()
    this.editor.focus()
  }

  // ---------------------------------------------------------------- settings & layout

  async set(patch: Partial<Settings>) {
    this.onSettings(await api.setSettings(patch))
  }

  private onSettings(s: Settings) {
    const prev = this.settings
    this.settings = s
    applyAppearance(s)
    this.editor.applySettings(s)
    this.applyLayout()
    this.library.onSettings(prev)
    this.preview.onSettings(prev)
    this.status.update()
  }

  applyLayout() {
    const s = this.settings
    const root = document.getElementById('app')!
    root.classList.toggle('show-sidebar', s.showSidebar)
    root.classList.toggle('show-preview', s.showPreview)
    root.classList.toggle('show-outline', s.showOutline)
    root.classList.toggle('show-stats', s.showStats)
    if (s.showPreview) this.preview.schedule()
    if (s.showOutline) this.outline.update()
  }

  // ---------------------------------------------------------------- documents

  get text() {
    return this.editor.text
  }

  get dirty() {
    return this.text !== this.saved
  }

  get title(): string {
    if (this.path) return this.settings.showExtensions ? basename(this.path) : stripExt(basename(this.path))
    return extractTitle(this.text, '') || 'Untitled'
  }

  get docDir(): string | null {
    return this.path ? dirname(this.path) : null
  }

  updateState = () => {
    const title = this.title
    document.querySelector('#titlebar .doc-title')!.textContent = title
    document.querySelector('#titlebar .doc-edited')!.textContent = this.dirty ? 'Edited' : ''
    document.title = title
    api.setDocumentState({ path: this.path, dirty: this.dirty, title })
  }

  onDocChanged() {
    this.updateState()
    this.preview.schedule()
    this.outline.schedule()
    this.status.schedule()
    if (this.settings.autosave) this.autosave()
  }

  onSelectionChanged() {
    this.status.schedule()
    this.outline.scheduleActive()
  }

  private autosave = debounce(() => {
    if (!this.dirty) return
    if (this.path || (this.text.trim() && this.library.saveFolder())) this.save().catch((e) => toast(String(e.message ?? e), { error: true }))
  }, 1200)

  /** Saves the current document; untitled documents land in the library folder you're browsing. */
  async save(opts: { as?: boolean } = {}): Promise<void> {
    if (this.saving) await this.saving
    const run = async () => {
      let path = this.path
      if (!path || opts.as) {
        const folder = this.library.saveFolder()
        const name = fileNameFromTitle(extractTitle(this.text, 'Untitled')) + '.' + this.settings.defaultExtension
        if (!opts.as && folder) path = await this.uniquePath(folder + '/' + name)
        else {
          path = await api.showSaveDialog({
            defaultPath: (this.docDir ?? folder ?? '') + '/' + name,
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
          })
          if (!path) return
        }
      }
      const text = this.text
      await api.writeFile(path, text)
      const fresh = path !== this.path
      this.path = path
      this.saved = text
      if (fresh) {
        api.watchFile(path)
        this.library.refresh()
      }
      this.updateState()
      api.setAuthorship(path, { borrowed: this.editor.borrowed })
      if (Date.now() - this.lastVersionCheck > 30_000 || fresh) {
        this.lastVersionCheck = Date.now()
        api.saveVersion(path, text, false)
      }
    }
    this.saving = run().finally(() => (this.saving = null))
    return this.saving
  }

  async uniquePath(path: string): Promise<string> {
    const m = /^(.*?)(\.[^./]+)?$/.exec(path)!
    let candidate = path
    for (let n = 2; await api.exists(candidate); n++) candidate = `${m[1]} ${n}${m[2] ?? ''}`
    return candidate
  }

  /** Leaves the current document safely before showing another one. */
  private async leave(): Promise<boolean> {
    this.autosave.cancel()
    if (!this.dirty) return true
    if (this.path || this.library.saveFolder()) {
      await this.save()
      return true
    }
    const choice = await api.confirm({ message: `Save changes to “${this.title}”?`, buttons: ['Save', 'Don’t Save', 'Cancel'] })
    if (choice === 2) return false
    if (choice === 0) await this.save()
    return !this.dirty || choice === 1
  }

  async open(path: string, opts: { line?: number } = {}) {
    if (path === this.path) {
      if (opts.line != null) this.gotoLine(opts.line)
      return
    }
    if (!isTextFile(basename(path))) {
      api.openExternal(path)
      return
    }
    if (!(await this.leave())) return
    let text: string
    try {
      text = await api.readFile(path)
    } catch (e: any) {
      toast(`Couldn’t open ${basename(path)}: ${e.message ?? e}`, { error: true })
      return
    }
    const authorship = await api.getAuthorship(path)
    this.path = path
    this.saved = text
    this.editor.setDoc(text, authorship?.borrowed ?? [])
    api.watchFile(path)
    api.saveVersion(path, text, false)
    this.afterLoad()
    const recent = [path, ...this.settings.recent.filter((p) => p !== path)].slice(0, 30)
    api.setSettings({ recent })
    if (opts.line != null) this.gotoLine(opts.line)
  }

  async newDocument(dir?: string, content = '') {
    if (!(await this.leave())) return
    this.path = null
    this.saved = ''
    if (dir) this.library.showFolder(dir)
    this.editor.setDoc(content)
    this.saved = content
    api.watchFile(null)
    this.afterLoad()
  }

  private afterLoad() {
    this.updateState()
    this.preview.schedule(true)
    this.outline.update()
    this.status.update()
    this.library.highlightCurrent()
    this.editor.refreshImages()
    this.editor.focus()
  }

  gotoLine(line: number) {
    const doc = this.editor.view.state.doc
    this.editor.scrollToPos(doc.line(Math.max(1, Math.min(doc.lines, line + 1))).from)
  }

  private async onExternalChange(path: string) {
    if (path !== this.path) return
    const exists = await api.exists(path)
    if (!exists) {
      // Moved or deleted elsewhere: keep the text, mark unsaved so it isn't lost.
      this.path = null
      this.saved = ''
      this.updateState()
      toast(`“${basename(path)}” was moved or deleted. Save to keep it.`, { error: true })
      return
    }
    const disk = await api.readFile(path).catch(() => null)
    if (disk == null || disk === this.saved) return
    if (!this.dirty) {
      this.saved = disk
      this.editor.replaceDoc(disk)
      this.updateState()
      return
    }
    const choice = await api.confirm({
      message: `“${basename(path)}” changed on disk.`,
      detail: 'Do you want to reload it and lose your unsaved changes, or keep your version?',
      buttons: ['Keep My Version', 'Reload']
    })
    if (choice === 1) {
      this.saved = disk
      this.editor.replaceDoc(disk)
      this.updateState()
    }
  }

  async rename() {
    if (!this.path) {
      await this.save({ as: true })
      return
    }
    const name = basename(this.path)
    const ext = /\.[^.]+$/.exec(name)?.[0] ?? ''
    const next = await prompt('Rename Document', name, { okLabel: 'Rename', select: [0, name.length - ext.length] })
    if (!next || next === name) return
    const target = dirname(this.path) + '/' + (/\.[^.]+$/.test(next) ? next : next + ext)
    try {
      await this.save()
      await api.rename(this.path, target)
      this.path = target
      api.watchFile(target)
      this.updateState()
      this.library.refresh()
    } catch (e: any) {
      toast(e.message ?? String(e), { error: true })
    }
  }

  async refreshFiles() {
    const all = await Promise.all(this.settings.libraryLocations.map((l) => api.listAllFiles(l).catch(() => [])))
    this.files = all.flat()
    api.tags(this.settings.libraryLocations).then((t) => (this.tagList = t.map((x) => x.tag)))
    api.watchLibrary(this.settings.libraryLocations)
    this.library.refresh()
  }

  // ---------------------------------------------------------------- editor host

  documents() {
    return this.files.filter((f) => isTextFile(f.name)).map((f) => ({ title: stripExt(f.name), name: f.name }))
  }

  async relativeFiles(): Promise<string[]> {
    const dir = this.docDir
    if (!dir) return []
    const files = await api.listAllFiles(dir)
    return files.filter((f) => f.path !== this.path).map((f) => f.path.slice(dir.length + 1))
  }

  tags() {
    const own = extractTags(this.text)
    return [...new Set([...own, ...this.tagList])]
  }

  fileUrl(path: string) {
    return 'fw-file://local' + path.split('/').map(encodeURIComponent).join('/')
  }

  resolveImage(src: string): string | null {
    if (/^https?:/i.test(src)) return src
    if (/^data:image\//.test(src)) return src
    const path = resolvePath(this.path, src.startsWith('/') ? src : './' + src)
    return path ? this.fileUrl(path) : null
  }

  resolveWiki(target: string): string | null {
    const t = target.toLowerCase().replace(/#.*$/, '')
    const candidates = this.files.filter((f) => isTextFile(f.name) && (stripExt(f.name).toLowerCase() === t || stripExt(f.path).toLowerCase().endsWith('/' + t)))
    if (!candidates.length) return null
    const dir = this.docDir
    return (candidates.find((c) => dir && dirname(c.path) === dir) ?? candidates[0]).path
  }

  async openLink(link: LinkTarget) {
    switch (link.kind) {
      case 'url':
        if (/^[a-z]+:/i.test(link.target)) api.openExternal(link.target)
        else {
          const p = resolvePath(this.path, './' + link.target)
          if (p) this.open(p)
        }
        break
      case 'wiki': {
        const p = this.resolveWiki(link.target)
        if (p) this.open(p)
        else if (this.docDir || this.library.saveFolder()) {
          const dir = this.docDir ?? this.library.saveFolder()!
          const path = `${dir}/${fileNameFromTitle(link.target)}.${this.settings.defaultExtension}`
          const ok = await api.confirm({ message: `Create “${link.target}”?`, detail: `A new document will be created in ${dir}.`, buttons: ['Create', 'Cancel'] })
          if (ok === 0) {
            await api.writeFile(path, `# ${link.target}\n\n`)
            await this.refreshFiles()
            this.open(path)
          }
        }
        break
      }
      case 'tag':
        this.library.showTag(link.target)
        if (!this.settings.showSidebar) this.set({ showSidebar: true })
        break
      case 'block': {
        const p = resolvePath(this.path, link.target)
        if (p) this.open(p)
        break
      }
      case 'footnote': {
        const doc = this.text
        const def = doc.indexOf(`[${link.target}]:`)
        const ref = doc.indexOf(`[${link.target}]`)
        const here = this.editor.view.state.selection.main.head
        this.editor.scrollToPos(def >= 0 && Math.abs(here - def) > 4 ? def : ref)
        break
      }
    }
  }

  async ignoreStylePhrase(phrase: string) {
    const sc = this.settings.styleCheck
    if (!sc.ignored.includes(phrase)) await this.set({ styleCheck: { ...sc, ignored: [...sc.ignored, phrase] } })
  }

  async handleDrop(files: File[], pos: number): Promise<boolean> {
    const lines: string[] = []
    for (const f of files) {
      const src = api.getPathForFile(f)
      if (!src) continue
      if (!this.path) {
        lines.push(this.settings.dropInsert === 'markdown' ? `![](${this.fileUrl(src)})` : `/${src}`)
        continue
      }
      let target = src
      const dir = this.docDir!
      if (!src.startsWith(dir + '/')) {
        target = await this.uniquePath(`${dir}/${this.settings.assetsFolder}/${basename(src)}`)
        await api.mkdir(dirname(target))
        await api.copyFile(src, target)
      }
      const rel = target.slice(dir.length + 1).split('/').map((p) => (this.settings.dropInsert === 'markdown' ? encodeURIComponent(p) : p)).join('/')
      lines.push(this.settings.dropInsert === 'markdown' && /\.(png|jpe?g|gif|svg|webp)$/i.test(rel) ? `![](${rel})` : `/${rel}`)
    }
    if (!lines.length) return false
    const view = this.editor.view
    const line = view.state.doc.lineAt(pos)
    const at = line.text.trim() ? line.to : line.from
    const insert = (line.text.trim() ? '\n' : '') + lines.join('\n') + '\n'
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.drop' })
    this.refreshFiles()
    return true
  }

  // ---------------------------------------------------------------- rendering

  renderContext(): RenderContext {
    return {
      docPath: this.path,
      readFile: (p) => api.readFile(p),
      fileUrl: (p) => this.fileUrl(p),
      resolveWiki: (t) => this.resolveWiki(t)
    }
  }

  render(): Promise<Rendered> {
    return renderMarkdown(this.text, this.renderContext())
  }

  exportTo(format: Parameters<typeof exportTo>[1], target: string, templateId?: string) {
    return exportTo(this, format, target, templateId)
  }

  // ---------------------------------------------------------------- commands

  run(id: string, arg?: unknown) {
    const cmd = this.commands.get(id)
    if (!cmd) return console.warn('Unknown command', id)
    try {
      const r = cmd.run(arg)
      if (r instanceof Promise) r.catch((e) => toast(String(e?.message ?? e), { error: true }))
    } catch (e: any) {
      toast(String(e?.message ?? e), { error: true })
    }
  }

  private registerCommands() {
    const v = () => this.editor.view
    const s = () => this.settings
    const add = (id: string, title: string, run: Command['run'], hidden = false) => this.commands.set(id, { id, title, run, hidden })
    const toggle = (key: 'showSidebar' | 'showPreview' | 'showOutline' | 'showStats' | 'typewriter') => () => this.set({ [key]: !s()[key] })

    add('new', 'New Document', () => this.newDocument())
    add('newWindow', 'New Window', () => api.newWindow())
    add('newFolder', 'New Folder', () => this.library.newFolder())
    add('open', 'Open…', async () => {
      const paths = await api.showOpenDialog({ filters: [{ name: 'Text', extensions: ['md', 'markdown', 'mdown', 'txt', 'text'] }] })
      if (!paths) return
      await this.open(paths[0])
      for (const p of paths.slice(1)) api.newWindow(p)
    })
    add('quickOpen', 'Quick Open…', () => this.palette.quickOpen())
    add('palette', 'Command Palette…', () => this.palette.commands(), true)
    add('addLocation', 'Add Library Folder…', () => this.library.addLocation())
    add('save', 'Save', () => this.save())
    add('saveAs', 'Save As…', () => this.save({ as: true }))
    add('saveAndClose', 'Save and Close', async () => {
      await this.save()
      if (!this.dirty) window.close()
    }, true)
    add('rename', 'Rename…', () => this.rename())
    add('duplicate', 'Duplicate', async () => {
      if (!this.path) return
      await this.save()
      const copy = await this.uniquePath(this.path.replace(/(\.[^./]+)?$/, ' copy$1'))
      await api.copyFile(this.path, copy)
      await this.open(copy)
      this.library.refresh()
    })
    add('trash', 'Move to Trash', async () => {
      if (!this.path) return this.newDocument()
      const ok = await api.confirm({ message: `Move “${basename(this.path)}” to the Trash?`, buttons: ['Move to Trash', 'Cancel'] })
      if (ok !== 0) return
      const p = this.path
      this.saved = this.text
      await api.trash(p)
      this.path = null
      await this.newDocument()
      this.library.refresh()
    })
    add('reveal', 'Reveal in Finder', () => this.path && api.reveal(this.path))
    add('saveVersion', 'Save Version…', async () => {
      if (!this.path) await this.save()
      if (!this.path) return
      const label = await prompt('Save Version', '', { label: 'Name this version (optional):', okLabel: 'Save Version' })
      if (label === null) return
      await this.save()
      const saved = await api.saveVersion(this.path, this.text, true, label || 'Saved version')
      toast(saved ? 'Version saved.' : 'No changes since the last version.')
    })
    add('versions', 'Browse Versions…', () => openVersions(this))
    add('export', 'Export…', (format?: string) => (format ? quickExport(this, format as any) : openExport(this)))
    add('publish', 'Publish…', () => openPublish(this))
    add('print', 'Print…', () => quickExport(this, 'print'))
    add('preferences', 'Settings…', (tab?: string) => openPreferences(this, tab))

    add('undo', 'Undo', () => this.editor.undo(), true)
    add('redo', 'Redo', () => this.editor.redo(), true)
    add('pastePlain', 'Paste as Plain Text', async () => {
      const text = await navigator.clipboard.readText()
      v().dispatch(v().state.replaceSelection(text), { userEvent: 'input.paste' })
    })
    add('copyHtml', 'Copy as HTML', () => copyAs(this, 'html'))
    add('copyRich', 'Copy as Rich Text', () => copyAs(this, 'rich'))
    add('find', 'Find…', () => openSearchPanel(v()))
    add('replace', 'Find and Replace…', () => {
      openSearchPanel(v())
      setTimeout(() => (document.querySelector('.cm-search input[name=replace]') as HTMLInputElement | null)?.focus())
    })
    add('findNext', 'Find Next', () => findNext(v()), true)
    add('findPrev', 'Find Previous', () => findPrevious(v()), true)
    add('searchLibrary', 'Search Library…', () => {
      if (!s().showSidebar) this.set({ showSidebar: true })
      this.library.focusSearch(this.editor.selectionText().split('\n')[0])
    })
    add('gotoHeading', 'Go to Heading…', () => this.palette.headings())
    add('markBorrowed', 'Mark Selection as Borrowed', () => {
      const r = v().state.selection.main
      v().dispatch({ effects: markBorrowed.of({ from: r.from, to: r.to, borrowed: true }) })
      this.status.update()
      if (this.path) api.setAuthorship(this.path, { borrowed: this.editor.borrowed })
    })
    add('markMine', 'Mark Selection as Mine', () => {
      const r = v().state.selection.main
      v().dispatch({ effects: markBorrowed.of({ from: r.from, to: r.to, borrowed: false }) })
      this.status.update()
      if (this.path) api.setAuthorship(this.path, { borrowed: this.editor.borrowed })
    })

    add('bold', 'Bold', () => toggleWrap(v(), '**'))
    add('italic', 'Italic', () => toggleWrap(v(), '_'))
    add('strike', 'Strikethrough', () => toggleWrap(v(), '~~'))
    add('highlight', 'Highlight', () => toggleWrap(v(), '=='))
    add('code', 'Inline Code', () => toggleWrap(v(), '`'))
    add('link', 'Insert Link', () => insertLink(v()))
    add('wikilink', 'Insert Wiki Link', () => insertLink(v(), true))
    add('footnote', 'Insert Footnote', () => insertFootnote(v()))
    add('heading', 'Heading', (n: number) => setLinePrefix(v(), 'heading', n), true)
    for (let n = 1; n <= 6; n++) add(`heading${n}`, `Heading ${n}`, () => setLinePrefix(v(), 'heading', n))
    add('quote', 'Quote', () => setLinePrefix(v(), 'quote'))
    add('bulletList', 'Bulleted List', () => setLinePrefix(v(), 'bullet'))
    add('numberedList', 'Numbered List', () => setLinePrefix(v(), 'number'))
    add('taskList', 'Task List', () => setLinePrefix(v(), 'task'))
    add('toggleTask', 'Toggle Task Done', () => toggleTask(v()))
    add('codeBlock', 'Code Block', () => insertCodeBlock(v()))
    add('rule', 'Horizontal Rule', () => insertText(v(), '---', true))
    add('insertTable', 'Insert Table', () => insertTable(v()))
    add('formatTable', 'Tidy Table', () => tidyTable(v()) || toast('Put the cursor inside a table first.'))
    add('insertBlock', 'Insert Content Block…', async () => {
      const files = await this.relativeFiles()
      this.palette.pick(
        'Insert content block',
        files.map((f) => ({ label: f, detail: '' })),
        (item) => insertText(v(), '/' + item.label, true)
      )
    })
    add('indent', 'Indent', () => indentMore(v()), true)
    add('outdent', 'Outdent', () => indentLess(v()), true)
    add('lineUp', 'Move Line Up', () => moveLineUp(v()), true)
    add('lineDown', 'Move Line Down', () => moveLineDown(v()), true)

    add('toggleSidebar', 'Toggle Library', toggle('showSidebar'))
    add('toggleOutline', 'Toggle Outline', toggle('showOutline'))
    add('togglePreview', 'Toggle Preview', toggle('showPreview'))
    add('toggleStats', 'Toggle Stats', toggle('showStats'))
    add('toggleTypewriter', 'Toggle Typewriter Mode', toggle('typewriter'))
    add('toggleFocus', 'Toggle Focus Mode', () => {
      const current = s().focusMode
      const last = (localStorage.getItem('fw-last-focus') as Settings['focusMode']) || 'sentence'
      if (current !== 'off') localStorage.setItem('fw-last-focus', current)
      this.set({ focusMode: current === 'off' ? last : 'off' })
    })
    add('toggleSyntax', 'Toggle Syntax Highlight', () => {
      const on = Object.values(s().syntax).some(Boolean)
      const saved = JSON.parse(localStorage.getItem('fw-last-syntax') ?? 'null')
      if (on) localStorage.setItem('fw-last-syntax', JSON.stringify(s().syntax))
      this.set({ syntax: on ? { adjectives: false, nouns: false, adverbs: false, verbs: false, conjunctions: false } : saved ?? { adjectives: true, nouns: true, adverbs: true, verbs: true, conjunctions: true } })
    })
    add('toggleStyle', 'Toggle Style Check', () => {
      const sc = s().styleCheck
      const on = sc.fillers || sc.cliches || sc.redundancies
      this.set({ styleCheck: { ...sc, fillers: !on, cliches: !on, redundancies: !on } })
    })
    add('toggleDark', 'Toggle Dark Mode', () => {
      const dark = document.documentElement.dataset.theme === 'dark'
      this.set({ theme: dark ? 'light' : 'dark' })
    })
    add('guide', 'Writing Guide', () => this.newDocument(undefined, guideText))
    add('cheatsheet', 'Markdown Cheat Sheet', () => openCheatsheet())
  }
}

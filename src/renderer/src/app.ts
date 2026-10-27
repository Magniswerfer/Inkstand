import type { DirEntry, Settings } from '@shared/types'
import { extractTags, extractTitle, fileNameFromTitle, isTextFile, relativePath } from '@shared/text'
import { Editor } from './editor'
import { markAs, type Span } from './editor/authorship'
import { parseAuthorship, sha256, writeAuthorship, type AuthorEntry } from '@shared/authorship-file'
import type { Author } from '@shared/types'
import { editTableAt, insertBlock, insertCallout, insertCodeBlock, insertDate, insertFootnote, insertImageLink, insertLink, insertTable, insertText, setLinePrefix, tidyTable, toggleComment, toggleTask, toggleWrap, type Callout } from './editor/format'
import { transformSelection, type CaseMode } from './editor/transform'
import { pasteEdits } from './editor/edits'
import { startSpeaking, stopSpeaking } from './editor/speech'
import { startCompletion } from '@codemirror/autocomplete'
import type { TableOp } from './markdown/table'
import { htmlToMarkdown } from './editor'
import type { LinkTarget } from './editor/markup'
import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands'
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { renderMarkdown, resolvePath, type RenderContext, type Rendered } from './markdown/render'
import { basename, debounce, dirname, stripExt } from './ui/dom'
import { prompt, toast } from './ui/overlay'
import { Library, sidebarResizer } from './ui/library'
import { Preview } from './ui/preview'
import { Outline } from './ui/outline'
import { StatusBar } from './ui/statusbar'
import { Palette } from './ui/palette'
import { openPreferences } from './ui/prefs'
import { openVersions } from './ui/versions'
import { openExport, quickExport, copyAs, exportTo } from './ui/export'
import { openPublish } from './ui/publish'
import { openCheatsheet, guideText } from './ui/help'
import { openGetInfo } from './ui/info'
import { applyAppearance, onMetrics } from './appearance'

const api = window.api

export interface Command {
  id: string
  title: string
  run: (arg?: any) => unknown
  /** Hidden from the command palette. */
  hidden?: boolean
}

/** Colours handed to new authors in turn. */
export const AUTHOR_COLORS = ['#8a8f99', '#b5651d', '#7b3fb0', '#1f7a5a', '#b23a48', '#2f6db0', '#9a7d0a']

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
    onMetrics(() => this.editor.remeasure())
    this.library = new Library(this, root.querySelector('#sidebar')!)
    sidebarResizer(root.querySelector('#sidebar')!, root)
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
    // Each change arrives twice (the reply and the broadcast to every window); apply it once.
    if (JSON.stringify(prev) === JSON.stringify(s)) return
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
    root.classList.toggle('preview-full', s.showPreview && s.previewMode === 'full')
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
      await api.writeFile(path, await this.fileContent(text))
      const fresh = path !== this.path
      this.path = path
      this.saved = text
      if (fresh) {
        api.watchFile(path)
        this.library.refresh()
      }
      this.updateState()
      api.setAuthorship(path, { spans: this.editor.spans, sha256: await sha256(text) })
      if (Date.now() - this.lastVersionCheck > 30_000 || fresh) {
        this.lastVersionCheck = Date.now()
        api.saveVersion(path, text, false)
      }
    }
    this.saving = run().finally(() => (this.saving = null))
    return this.saving
  }

  /** What goes on disk: the text, plus its authorship block when that's kept in the file. */
  private async fileContent(text: string): Promise<string> {
    const a = this.settings.authorship
    if (!a.enabled || !a.storeInFile) return text
    return writeAuthorship(text, this.authorEntries(this.editor.spans))
  }

  private authorEntries(spans: Span[]): AuthorEntry[] {
    const byId = new Map<string, AuthorEntry>()
    for (const [from, to, id] of spans) {
      const author = this.settings.authorship.authors.find((x) => x.id === id)
      if (!author) continue
      if (!byId.has(id)) byId.set(id, { name: author.name, kind: author.kind, ranges: [] })
      byId.get(id)!.ranges.push([from, to])
    }
    return [...byId.values()]
  }

  /** Reads a file's text and authorship, from the file itself or the local store. */
  private async load(path: string, raw: string): Promise<{ text: string; spans: Span[] }> {
    const parsed = await parseAuthorship(raw)
    const reset = () => toast(`“${basename(path)}” was edited in another app, so its authorship was reset.`)
    if (parsed.stale) {
      reset()
      return { text: parsed.body, spans: [] }
    }
    if (parsed.entries.length) return { text: parsed.body, spans: await this.spansFromEntries(parsed.entries) }
    // Kept on this computer instead: only trust it if the text is unchanged since.
    const local = await api.getAuthorship(path)
    const spans = local?.spans ?? (local?.borrowed ?? []).map(([a, b]) => [a, b, 'pasted'] as Span)
    if (!spans.length) return { text: parsed.body, spans: [] }
    if (local?.sha256 && local.sha256 !== (await sha256(parsed.body))) {
      reset()
      return { text: parsed.body, spans: [] }
    }
    return { text: parsed.body, spans: spans.filter(([, b]) => b <= parsed.body.length) }
  }

  /** Maps authors named in a file to local authors, adding any this computer hasn't seen. */
  private async spansFromEntries(entries: AuthorEntry[]): Promise<Span[]> {
    const authors = [...this.settings.authorship.authors]
    const spans: Span[] = []
    for (const e of entries) {
      let a = authors.find((x) => x.name.toLowerCase() === e.name.toLowerCase())
      if (!a) {
        a = { id: crypto.randomUUID(), name: e.name, kind: e.kind, color: AUTHOR_COLORS[authors.length % AUTHOR_COLORS.length] }
        authors.push(a)
      }
      for (const [from, to] of e.ranges) spans.push([from, to, a.id])
    }
    if (authors.length !== this.settings.authorship.authors.length) await this.set({ authorship: { ...this.settings.authorship, authors } })
    return spans
  }

  /** Saves after authorship changed without the text changing (Mark As). */
  private authorshipChanged() {
    this.status.update()
    if (this.path) this.save().catch((e) => toast(String(e.message ?? e), { error: true }))
  }

  async newAuthor(): Promise<Author | null> {
    const name = (await prompt('New Author', '', { label: 'Name (a person, an AI tool, or a source):', okLabel: 'Add' }))?.trim()
    if (!name) return null
    const a = this.settings.authorship
    const existing = a.authors.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    const kind: Author['kind'] = /gpt|claude|gemini|copilot|llama|mistral|\bai\b/i.test(name) ? 'ai' : 'human'
    const author: Author = { id: crypto.randomUUID(), name, kind, color: AUTHOR_COLORS[a.authors.length % AUTHOR_COLORS.length] }
    await this.set({ authorship: { ...a, authors: [...a.authors, author] } })
    return author
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
    const doc = await this.load(path, text)
    this.path = path
    this.saved = doc.text
    this.editor.setDoc(doc.text, doc.spans)
    api.watchFile(path)
    api.saveVersion(path, doc.text, false)
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
    const raw = await api.readFile(path).catch(() => null)
    if (raw == null) return
    const disk = (await parseAuthorship(raw)).body
    if (disk === this.saved) return
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

  /** Moves the open document on disk without reloading it. */
  async relocate(to: string) {
    const from = this.path
    if (!from || from === to) return
    await this.save()
    api.watchFile(null)
    // Point at the new path first, so the watcher doesn't mistake the move for a deletion.
    this.path = to
    try {
      await api.rename(from, to)
    } catch (e) {
      this.path = from
      api.watchFile(from)
      throw e
    }
    api.watchFile(to)
    this.updateState()
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
      await this.relocate(target)
      this.library.refresh()
    } catch (e: any) {
      toast(e.message ?? String(e), { error: true })
    }
  }

  async refreshFiles() {
    const all = await Promise.all(this.settings.libraryLocations.map((l) => api.listAllFiles(l).catch(() => [])))
    this.files = all.flat()
    api.tags(this.settings.libraryLocations).then((t) => {
      const next = t.map((x) => x.tag)
      if (next.join() === this.tagList.join()) return
      this.tagList = next
      this.library.refresh()
    })
    api.watchLibrary(this.settings.libraryLocations)
    this.library.refresh()
  }

  // ---------------------------------------------------------------- editor host

  /** Documents for [[ completion: what to show, and what to insert (a name, or a path from here). */
  documents() {
    const byPath = this.settings.links.wikiInsert === 'path' && this.docDir
    return this.files
      .filter((f) => isTextFile(f.name) && f.path !== this.path)
      .map((f) => ({ label: stripExt(f.name), detail: dirname(f.path).replace(/^\/Users\/[^/]+/, '~'), insert: byPath ? relativePath(this.docDir!, stripExt(f.path)) : stripExt(f.name) }))
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
    const t = target.replace(/#.*$/, '').trim()
    const texts = this.files.filter((f) => isTextFile(f.name))
    if (this.settings.links.wikiResolve === 'relative' && this.path) {
      // A path from this document's folder, with or without the extension.
      const base = resolvePath(this.path, './' + t)
      const hit = base && texts.find((f) => f.path === base || stripExt(f.path) === base)
      if (hit) return hit.path
    }
    const lower = t.toLowerCase()
    const candidates = texts.filter((f) => stripExt(f.name).toLowerCase() === lower || stripExt(f.path).toLowerCase().endsWith('/' + lower))
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
      singleReturnParagraphs: this.settings.markdown.singleReturnParagraphs,
      math: this.settings.markdown.math,
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
    add('getInfo', 'Get Info', () => (this.path ? openGetInfo(this, this.path) : toast('Save the document first.')))
    add('moveTo', 'Move To…', () => (this.path ? this.library.moveDocument(this.path) : toast('Save the document first.')))
    add('showInLibrary', 'Show in Library', () => {
      if (!s().showSidebar) this.set({ showSidebar: true })
      this.library.showCurrent()
    })
    add('filter', 'Filter Library', () => {
      if (!s().showSidebar) this.set({ showSidebar: true })
      this.library.focusFilter()
    })
    add('toggleOrganizer', 'Toggle Organizer', () => this.set({ showOrganizer: !s().showOrganizer }))
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
    const pasteAs = async (kind: 'plain' | 'markdown' | 'quote' | 'code') => {
      const items = await navigator.clipboard.read().catch(() => [])
      const htmlItem = items.find((i) => i.types.includes('text/html'))
      const html = htmlItem ? await (await htmlItem.getType('text/html')).text() : ''
      let text = await navigator.clipboard.readText()
      if (kind === 'markdown' && html) text = htmlToMarkdown(html)
      if (kind === 'quote') text = text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
      if (kind === 'code') text = '```\n' + text.replace(/\n$/, '') + '\n```'
      v().dispatch(v().state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true })
      v().focus()
    }
    add('pastePlain', 'Paste as Plain Text', () => pasteAs('plain'))
    add('pasteAs', 'Paste As', (kind: 'plain' | 'markdown' | 'quote' | 'code') => pasteAs(kind), true)
    add('pasteMarkdown', 'Paste as Markdown', () => pasteAs('markdown'))
    add('pasteQuote', 'Paste as Quote', () => pasteAs('quote'))
    add('pasteCode', 'Paste as Code Block', () => pasteAs('code'))
    add('copyMarkdown', 'Copy Markdown', async () => {
      await navigator.clipboard.writeText(this.editor.selectionText() || this.text)
      toast('Copied Markdown.')
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
    add('markAs', 'Mark As', async (authorId: string) => {
      const id = authorId === 'new' ? (await this.newAuthor())?.id : authorId
      if (id === undefined) return
      const r = v().state.selection.main
      if (r.empty) return toast('Select the text to credit first.')
      v().dispatch({ effects: markAs.of({ from: r.from, to: r.to, author: id }) })
      this.authorshipChanged()
    }, true)
    add('markMine', 'Mark Selection as Mine', () => this.run('markAs', ''))
    add('markPasted', 'Mark Selection as Pasted', () => this.run('markAs', this.settings.authorship.pasteAuthor || 'pasted'))
    add('newAuthor', 'New Author…', () => this.newAuthor())
    add('pasteEdits', 'Paste Edits From', async (authorId: string) => {
      const id = authorId === 'new' ? (await this.newAuthor())?.id : authorId
      if (!id) return
      pasteEdits(v(), await navigator.clipboard.readText(), id)
      this.authorshipChanged()
    }, true)
    add('toggleAuthors', 'Toggle Show Authors', () => this.set({ authorship: { ...s().authorship, showBorrowed: !s().authorship.showBorrowed } }))
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
    add('insertDate', 'Add Date', () => insertDate(v()))
    add('insertHashtag', 'Add Hashtag', () => {
      insertText(v(), '#')
      startCompletion(v())
    })
    add('insertPageBreak', 'Add Page Break', () => insertBlock(v(), '<div class="page-break"></div>'))
    add('insertToc', 'Add Table of Contents', () => insertBlock(v(), '[TOC]'))
    add('insertImage', 'Add Image Link', () => insertImageLink(v()))
    add('insertMath', 'Add Display Math', () => insertBlock(v(), '$$\n\n$$', 3))
    add('comment', 'Comment', () => toggleComment(v()))
    add('callout', 'Callout', (kind: Callout) => insertCallout(v(), kind), true)
    for (const k of ['note', 'tip', 'important', 'warning', 'caution'] as Callout[]) add(`callout-${k}`, `Callout: ${k[0].toUpperCase() + k.slice(1)}`, () => insertCallout(v(), k))
    add('case', 'Change Case', (mode: CaseMode) => transformSelection(v(), mode), true)
    add('titleCase', 'Make Title Case', () => transformSelection(v(), 'title'))
    add('upperCase', 'Make Upper Case', () => transformSelection(v(), 'upper'))
    add('lowerCase', 'Make Lower Case', () => transformSelection(v(), 'lower'))
    add('capitalize', 'Capitalize', () => transformSelection(v(), 'capitalize'))
    const TABLE_OPS: [TableOp, string][] = [
      ['rowAbove', 'Add Row Above'], ['rowBelow', 'Add Row Below'], ['deleteRow', 'Delete Row'], ['rowUp', 'Move Row Up'], ['rowDown', 'Move Row Down'],
      ['colBefore', 'Add Column Before'], ['colAfter', 'Add Column After'], ['deleteCol', 'Delete Column'], ['colLeft', 'Move Column Left'], ['colRight', 'Move Column Right'],
      ['alignLeft', 'Align Column Left'], ['alignCenter', 'Align Column Center'], ['alignRight', 'Align Column Right'],
      ['sortAsc', 'Sort Column Ascending'], ['sortDesc', 'Sort Column Descending'], ['transpose', 'Transpose Rows and Columns']
    ]
    add('table', 'Edit Table', (op: TableOp) => editTableAt(v(), op) || toast('Put the cursor inside a table first.'), true)
    for (const [op, title] of TABLE_OPS) add(`table-${op}`, `Table: ${title}`, () => editTableAt(v(), op) || toast('Put the cursor inside a table first.'))
    add('indent', 'Indent', () => indentMore(v()), true)
    add('outdent', 'Outdent', () => indentLess(v()), true)
    add('lineUp', 'Move Line Up', () => moveLineUp(v()), true)
    add('lineDown', 'Move Line Down', () => moveLineDown(v()), true)

    add('toggleSidebar', 'Toggle Library', toggle('showSidebar'))
    add('toggleOutline', 'Toggle Outline', toggle('showOutline'))
    add('togglePreview', 'Toggle Preview', toggle('showPreview'))
    add('fullPreview', 'Toggle Full Preview', () =>
      this.set(s().showPreview && s().previewMode === 'full' ? { previewMode: 'split' } : { showPreview: true, previewMode: 'full' })
    )
    add('previewZoom', 'Preview Zoom', (zoom: 'width' | 'page') => this.set({ showPreview: true, previewZoom: zoom }), true)
    add('fitWidth', 'Preview: Fit Width', () => this.set({ showPreview: true, previewZoom: 'width' }))
    add('fitPage', 'Preview: Fit Page', () => this.set({ showPreview: true, previewZoom: 'page' }))
    add('reloadPreview', 'Reload Preview', () => this.preview.reload())
    add('startSpeaking', 'Start Speaking', () => startSpeaking(v(), () => this.status.update()))
    add('stopSpeaking', 'Stop Speaking', () => stopSpeaking())
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

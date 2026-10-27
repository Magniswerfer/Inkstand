// The library: an organizer column (locations, favourites, smart folders, hashtags) beside a file
// browser with a sort bar, a filter bar and multi-selection.
import type { DirEntry, SearchHit, Settings, SmartFolder, SortOrder } from '@shared/types'
import { matchQuery, parseQuery, queryTerms } from '@shared/query'
import type { App } from '../app'
import { basename, clear, debounce, dirname, h, icon, relativeTime, stripExt } from './dom'
import { contextMenu, prompt, toast, type MenuItem } from './overlay'
import { openGetInfo } from './info'
import { editSmartFolder } from './smartfolder'

const api = window.api

type View =
  | { kind: 'home' }
  | { kind: 'folder'; path: string }
  | { kind: 'search'; query: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'smart'; id: string }

/** One row in the file browser. */
interface Item {
  path: string
  name: string
  isDir: boolean
  title: string
  excerpt: string
  mtime: number
  ctime: number
  size: number
  line?: number
  terms?: string[]
}

/** The built-in Recent smart folder. */
const RECENT: SmartFolder = { id: 'recent', name: 'Recent', query: '', rules: [{ field: 'dateModified', op: 'inPast', value: '7' }] }

export const SORTS: [SortOrder, string][] = [
  ['modified', 'Date Modified'],
  ['created', 'Date Created'],
  ['name', 'Name'],
  ['size', 'Size'],
  ['kind', 'Kind']
]

export class Library {
  private view: View = { kind: 'home' }
  private stack: View[] = []
  private organizer: HTMLElement
  private list: HTMLElement
  private header: HTMLElement
  private sortBar: HTMLElement
  private filter: HTMLInputElement
  private search: HTMLInputElement
  private items: Item[] = []
  private selected = new Set<string>()
  private anchor: string | null = null
  private renderToken = 0

  constructor(private app: App, root: HTMLElement) {
    this.search = h('input', {
      type: 'search',
      class: 'sb-search',
      placeholder: 'Search',
      spellcheck: 'false',
      'aria-label': 'Search library',
      oninput: () => this.onSearch(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this.search.value = ''
          this.onSearch()
          this.app.editor.focus()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          ;(this.list.querySelector('.sb-item') as HTMLElement | null)?.focus()
        } else if (e.key === 'Enter') (this.list.querySelector('.sb-item') as HTMLElement | null)?.click()
      }
    })
    this.filter = h('input', {
      type: 'search',
      class: 'sb-filter-input',
      placeholder: 'Filter',
      spellcheck: 'false',
      'aria-label': 'Filter this list',
      oninput: () => this.renderList(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this.filter.value = ''
          this.renderList()
        }
      }
    })
    this.organizer = h('nav', { class: 'sb-organizer', 'aria-label': 'Organizer' })
    this.header = h('div', { class: 'sb-header' })
    this.sortBar = h('div', { class: 'sb-sortbar' })
    this.list = h('div', { class: 'sb-list', role: 'listbox', 'aria-multiselectable': 'true', onkeydown: (e: KeyboardEvent) => this.onListKey(e) })
    const browser = h('div', { class: 'sb-browser' }, this.header, h('div', { class: 'sb-top' }, this.search), this.sortBar, this.list, h('div', { class: 'sb-filter' }, this.filter))
    root.append(this.organizer, browser)

    const saved = localStorage.getItem('fw-library-view')
    if (saved) {
      try {
        this.view = JSON.parse(saved)
      } catch {
        // ignore
      }
    }
    if (this.view.kind === 'search' || (this.view.kind === 'home' && app.settings.showOrganizer)) this.view = { kind: 'home' }
    // Like iA Writer, open straight into your documents rather than an overview.
    const first = app.settings.libraryLocations[0]
    if ((!saved || this.view.kind === 'home') && first) this.view = { kind: 'folder', path: first }
    this.render()
  }

  onSettings(prev: Settings) {
    const s = this.app.settings
    if (prev.libraryLocations.join() !== s.libraryLocations.join()) return this.app.refreshFiles()
    const keys: (keyof Settings)[] = ['librarySort', 'librarySortReverse', 'showExtensions', 'favorites', 'smartFolders', 'showOrganizer', 'showSortBar', 'showFilterBar', 'recent']
    if (keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(s[k]))) this.render()
  }

  /** Folder that new and untitled documents are saved to. */
  saveFolder(): string | null {
    if (this.view.kind === 'folder') return this.view.path
    if (this.app.path) return dirname(this.app.path)
    return this.app.settings.libraryLocations[0] ?? null
  }

  refresh = debounce(() => this.render(), 150)

  showFolder(path: string) {
    this.go({ kind: 'folder', path })
  }

  showTag(tag: string) {
    this.go({ kind: 'tag', tag })
  }

  /** Reveals the current document in its folder. */
  showCurrent() {
    if (!this.app.path) return
    this.go({ kind: 'folder', path: dirname(this.app.path) })
  }

  focusSearch(text = '') {
    if (text) this.search.value = text
    this.search.focus()
    this.search.select()
    if (text) this.onSearch()
  }

  focusFilter() {
    if (!this.app.settings.showFilterBar) this.app.set({ showFilterBar: true })
    this.filter.focus()
    this.filter.select()
  }

  private go(view: View, push = true) {
    if (push && JSON.stringify(view) !== JSON.stringify(this.view)) this.stack.push(this.view)
    this.view = view
    this.selected.clear()
    this.filter.value = ''
    if (view.kind !== 'search') localStorage.setItem('fw-library-view', JSON.stringify(view))
    this.render()
  }

  private back() {
    const v = this.view
    if (v.kind === 'folder') {
      const loc = this.app.settings.libraryLocations.find((l) => v.path.startsWith(l))
      if (loc && v.path !== loc) return this.go({ kind: 'folder', path: dirname(v.path) }, false)
    }
    if (v.kind === 'search') this.search.value = ''
    let prev = this.stack.pop() ?? { kind: 'home' }
    if (prev.kind === 'search') prev = { kind: 'home' }
    this.go(prev, false)
  }

  private onSearch = debounce(() => {
    const q = this.search.value.trim()
    if (q) this.go({ kind: 'search', query: q }, this.view.kind !== 'search')
    else if (this.view.kind === 'search') this.back()
  }, 200)

  highlightCurrent() {
    for (const el of this.list.querySelectorAll<HTMLElement>('.sb-item[data-path]')) {
      el.classList.toggle('current', el.dataset.path === this.app.path)
      el.classList.toggle('selected', this.selected.has(el.dataset.path!))
    }
    for (const el of this.organizer.querySelectorAll<HTMLElement>('[data-view]')) el.classList.toggle('active', el.dataset.view === JSON.stringify(this.view))
  }

  // ------------------------------------------------------------------ rendering

  private async render() {
    const token = ++this.renderToken
    const s = this.app.settings
    const sidebar = this.organizer.parentElement!
    sidebar.classList.toggle('with-organizer', s.showOrganizer)
    this.sortBar.hidden = !s.showSortBar
    ;(this.filter.parentElement as HTMLElement).hidden = !s.showFilterBar
    const [items, title] = await this.load()
    if (token !== this.renderToken) return
    this.items = items
    if (s.showOrganizer) this.renderOrganizer()
    this.renderHeader(title)
    this.renderSortBar()
    this.renderList()
  }

  private async load(): Promise<[Item[], string]> {
    const v = this.view
    const s = this.app.settings
    const fromHit = (hit: SearchHit, terms: string[]): Item => ({ path: hit.path, name: hit.name, isDir: false, title: hit.title, excerpt: hit.snippet, mtime: hit.mtime, ctime: hit.mtime, size: 0, line: hit.line, terms })
    const fromEntry = (e: DirEntry, excerpt = ''): Item => ({ path: e.path, name: e.name, isDir: e.isDir, title: stripExt(e.name), excerpt, mtime: e.mtime, ctime: e.ctime, size: e.size })
    switch (v.kind) {
      case 'home':
        return [[], 'Library']
      case 'folder': {
        const entries = await api.listDir(v.path).catch(() => null)
        return [(entries ?? []).map((e) => ({ path: e.path, name: e.name, isDir: e.isDir, title: e.title, excerpt: e.excerpt, mtime: e.mtime, ctime: e.ctime, size: e.size })), basename(v.path)]
      }
      case 'search': {
        const terms = queryTerms(parseQuery(v.query))
        return [(await api.search(s.libraryLocations, v.query)).map((hit) => fromHit(hit, terms)), `“${v.query}”`]
      }
      case 'tag':
        return [(await api.search(s.libraryLocations, '#' + v.tag)).map((hit) => fromHit(hit, ['#' + v.tag])), '#' + v.tag]
      case 'favorites': {
        const stats = await Promise.all(s.favorites.map((p) => api.stat(p)))
        return [stats.filter((x): x is DirEntry => !!x).map((e) => fromEntry(e)), 'Favorites']
      }
      case 'recent': {
        const stats = await Promise.all(s.recent.map((p) => api.stat(p)))
        return [stats.filter((x): x is DirEntry => !!x && !x.isDir).map((e) => fromEntry(e, dirname(e.path).replace(/^\/Users\/[^/]+/, '~'))), 'Recent']
      }
      case 'smart': {
        const sf = v.id === 'recent' ? RECENT : s.smartFolders.find((f) => f.id === v.id)
        if (!sf) return [[], 'Smart Folder']
        const terms = queryTerms(parseQuery(sf.rules?.find((r) => r.field === 'search')?.value ?? sf.query))
        return [(await api.smartFolder(s.libraryLocations, sf)).map((hit) => ({ ...fromHit(hit, terms), isDir: false })), sf.name]
      }
    }
  }

  private sortItems(items: Item[]): Item[] {
    const { librarySort: sort, librarySortReverse: reverse } = this.app.settings
    const ext = (n: string) => n.split('.').pop()!.toLowerCase()
    const sorted = [...items].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let d: number
      if (sort === 'name' || (a.isDir && b.isDir && sort !== 'modified' && sort !== 'created')) d = a.name.localeCompare(b.name, undefined, { numeric: true })
      else if (sort === 'created') d = b.ctime - a.ctime
      else if (sort === 'size') d = b.size - a.size
      else if (sort === 'kind') d = ext(a.name).localeCompare(ext(b.name)) || a.name.localeCompare(b.name)
      else d = b.mtime - a.mtime
      return reverse ? -d : d
    })
    return sorted
  }

  private renderHeader(title: string) {
    const v = this.view
    const canBack = v.kind !== 'home' && !(v.kind === 'folder' && this.app.settings.libraryLocations.includes(v.path) && this.app.settings.showOrganizer)
    clear(this.header)
    this.header.append(
      canBack ? h('button', { class: 'fw-icon-btn', 'aria-label': 'Back', title: 'Back', onclick: () => this.back() }, icon('back')) : h('span', { class: 'sb-spacer' }),
      h('h3', { title: v.kind === 'folder' ? v.path : '' }, title),
      h(
        'button',
        {
          class: 'fw-icon-btn',
          'aria-label': 'New',
          title: 'New document (right-click for more)',
          onclick: () => this.app.newDocument(this.saveFolder() ?? undefined),
          oncontextmenu: (e: MouseEvent) =>
            contextMenu(e, [
              { label: 'New Document', action: () => this.app.newDocument(this.saveFolder() ?? undefined) },
              { label: 'New Folder…', action: () => this.newFolder() },
              { label: 'New Smart Folder…', action: () => this.newSmartFolder() }
            ])
        },
        icon('plus')
      )
    )
  }

  private renderSortBar() {
    const s = this.app.settings
    clear(this.sortBar)
    const label = SORTS.find(([k]) => k === s.librarySort)?.[1] ?? 'Date Modified'
    this.sortBar.append(
      h(
        'button',
        {
          class: 'sb-sort',
          onclick: (e: MouseEvent) =>
            contextMenu(e, [
              ...SORTS.map(([k, l]) => ({ label: l, checked: s.librarySort === k, action: () => this.app.set({ librarySort: k }) })),
              { separator: true, label: '' },
              { label: 'Reverse Order', checked: s.librarySortReverse, action: () => this.app.set({ librarySortReverse: !s.librarySortReverse }) }
            ])
        },
        `Sort by ${label}`,
        h('span', { class: 'chev' }, '⌄')
      )
    )
  }

  /** Renders the current items through the filter bar. */
  private renderList() {
    const v = this.view
    const q = this.filter.value.trim()
    const node = q ? parseQuery(q) : null
    const items = this.sortItems(this.items).filter((it) => !node || matchQuery(node, { name: it.name, text: `${it.title}\n${it.excerpt}` }))
    clear(this.list)
    if (v.kind === 'home') {
      this.list.append(...this.organizerSections(true))
    } else if (!items.length) {
      const msg =
        q ? 'Nothing matches the filter.'
        : v.kind === 'folder' ? 'No documents yet.'
        : v.kind === 'favorites' ? 'Right-click a document or folder, or drag it to Favorites.'
        : v.kind === 'search' ? 'No matches.'
        : 'Nothing here yet.'
      this.list.append(h('div', { class: 'sb-empty' }, msg))
    } else {
      for (const it of items) this.list.append(this.row(it))
    }
    if (v.kind === 'search') this.list.append(h('div', { class: 'sb-footer' }, h('button', { onclick: () => this.newSmartFolder(v.query) }, icon('smart'), 'Save as Smart Folder')))
    this.highlightCurrent()
  }

  private row(it: Item): HTMLElement {
    const s = this.app.settings
    const name = it.isDir || s.showExtensions ? it.name : stripExt(it.name)
    const excerpt = h('span', { class: 'excerpt' })
    const term = it.terms?.find((t) => it.excerpt.toLowerCase().includes(t))
    if (term) {
      const i = it.excerpt.toLowerCase().indexOf(term)
      excerpt.append(it.excerpt.slice(0, i), h('mark', null, it.excerpt.slice(i, i + term.length)), it.excerpt.slice(i + term.length))
    } else excerpt.append(it.excerpt)
    const row = h(
      'button',
      {
        class: `sb-item ${it.isDir ? 'sb-folder' : 'sb-file'}`,
        'data-path': it.path,
        draggable: 'true',
        role: 'option',
        onclick: (e: MouseEvent) => this.onRowClick(e, it),
        ondragstart: (e: DragEvent) => {
          const paths = this.selected.has(it.path) ? [...this.selected] : [it.path]
          e.dataTransfer?.setData('application/x-fw-paths', JSON.stringify(paths))
        },
        ...(it.isDir ? this.dropHandlers(it.path) : {})
      },
      icon(it.isDir ? 'folder' : 'file'),
      h(
        'span',
        { class: 'body' },
        h('span', { class: 'line1' }, h('span', { class: 'name' }, name), !it.isDir ? h('span', { class: 'date' }, relativeTime(it.mtime)) : null),
        !it.isDir && it.excerpt ? excerpt : null
      ),
      s.favorites.includes(it.path) ? h('span', { class: 'fav', 'aria-label': 'Favorite' }, '★') : null
    )
    row.addEventListener('contextmenu', (e) => {
      if (!this.selected.has(it.path)) {
        this.selected = new Set([it.path])
        this.highlightCurrent()
      }
      contextMenu(e, this.itemMenu(it))
    })
    return row
  }

  private onRowClick(e: MouseEvent, it: Item) {
    if (e.metaKey || e.ctrlKey) {
      if (this.selected.has(it.path)) this.selected.delete(it.path)
      else this.selected.add(it.path)
      this.anchor = it.path
      return this.highlightCurrent()
    }
    if (e.shiftKey && this.anchor) {
      const paths = [...this.list.querySelectorAll<HTMLElement>('.sb-item[data-path]')].map((el) => el.dataset.path!)
      const [a, b] = [paths.indexOf(this.anchor), paths.indexOf(it.path)].sort((x, y) => x - y)
      this.selected = new Set(paths.slice(a, b + 1))
      return this.highlightCurrent()
    }
    this.selected = new Set([it.path])
    this.anchor = it.path
    if (it.isDir) this.go({ kind: 'folder', path: it.path })
    else {
      this.highlightCurrent()
      this.app.open(it.path, it.line != null ? { line: it.line } : {})
    }
  }

  // ------------------------------------------------------------------ organizer

  private renderOrganizer() {
    clear(this.organizer)
    this.organizer.append(...this.organizerSections(false))
    this.highlightCurrent()
  }

  /** Locations, favourites, smart folders and hashtags; also the list's home view when the organizer is hidden. */
  private organizerSections(inList: boolean): HTMLElement[] {
    const s = this.app.settings
    const out: HTMLElement[] = []
    const section = (label: string, onAdd?: () => void, drop?: Partial<Record<string, unknown>>) =>
      h('div', { class: 'sb-section', ...(drop ?? {}) }, label, onAdd ? h('button', { class: 'sb-section-add', title: `Add to ${label}`, onclick: onAdd }, '+') : null)
    const nav = (ic: Parameters<typeof icon>[0], label: string, view: View, extra: Record<string, unknown> = {}, count?: number) =>
      h(
        'button',
        { class: 'sb-item sb-nav', 'data-view': JSON.stringify(view), onclick: () => this.go(view), ...extra },
        icon(ic),
        h('span', { class: 'name' }, label),
        count != null ? h('span', { class: 'count' }, String(count)) : null
      )

    out.push(section('Locations', () => this.addLocation()))
    for (const loc of s.libraryLocations) {
      const row = nav(/Mobile Documents/.test(loc) ? 'cloud' : 'folder', locationName(loc), { kind: 'folder', path: loc }, this.dropHandlers(loc))
      row.addEventListener('contextmenu', (e) => contextMenu(e, this.locationMenu(loc)))
      out.push(row)
    }
    if (!s.libraryLocations.length) out.push(h('div', { class: 'sb-hint' }, 'Add a folder to keep your documents in.'))

    const favDrop = {
      ondragover: (e: DragEvent) => e.dataTransfer?.types.includes('application/x-fw-paths') && e.preventDefault(),
      ondrop: (e: DragEvent) => {
        const paths: string[] = JSON.parse(e.dataTransfer?.getData('application/x-fw-paths') || '[]')
        this.app.set({ favorites: [...new Set([...s.favorites, ...paths])] })
      }
    }
    out.push(section('Favorites', undefined, favDrop))
    if (inList) out.push(nav('star', 'Favorites', { kind: 'favorites' }, {}, s.favorites.length))
    else {
      for (const p of s.favorites) {
        const row = nav(/\.[^/]+$/.test(basename(p)) ? 'file' : 'folder', stripExt(basename(p)), { kind: 'folder', path: p }, favDrop)
        row.onclick = () => (/\.[^/]+$/.test(basename(p)) ? this.app.open(p) : this.go({ kind: 'folder', path: p }))
        row.addEventListener('contextmenu', (e) => contextMenu(e, [{ label: 'Remove from Favorites', action: () => this.app.set({ favorites: s.favorites.filter((x) => x !== p) }) }, { label: 'Reveal in Finder', action: () => api.reveal(p) }]))
        out.push(row)
      }
      if (!s.favorites.length) out.push(h('div', { class: 'sb-hint', ...favDrop }, 'Drag folders and files here for quick access.'))
    }

    out.push(section('Smart Folders', () => this.newSmartFolder()))
    out.push(nav('clock', 'Recent', { kind: 'smart', id: 'recent' }))
    for (const sf of s.smartFolders) {
      const row = nav('smart', sf.name, { kind: 'smart', id: sf.id })
      row.addEventListener('contextmenu', (e) =>
        contextMenu(e, [
          { label: 'Edit…', action: () => editSmartFolder(this.app, sf) },
          { label: 'Delete', action: () => this.app.set({ smartFolders: s.smartFolders.filter((f) => f.id !== sf.id) }) }
        ])
      )
      out.push(row)
    }

    out.push(section('Hashtags'))
    const tags = this.app.tagList
    if (tags.length) for (const t of tags) out.push(nav('tag', t, { kind: 'tag', tag: t }))
    else out.push(h('div', { class: 'sb-hint' }, 'Write #tags to group files.'))
    return out
  }

  private dropHandlers(dir: string) {
    return {
      ondragover: (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes('application/x-fw-paths')) return
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).classList.add('drop')
      },
      ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop'),
      ondrop: (e: DragEvent) => {
        ;(e.currentTarget as HTMLElement).classList.remove('drop')
        const paths: string[] = JSON.parse(e.dataTransfer?.getData('application/x-fw-paths') || '[]')
        this.moveAll(paths, dir)
      }
    }
  }

  private onListKey(e: KeyboardEvent) {
    const items = [...this.list.querySelectorAll<HTMLElement>('.sb-item')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' && i < items.length - 1) items[i + 1].focus()
    else if (e.key === 'ArrowUp') (i > 0 ? items[i - 1] : this.search).focus()
    else if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && e.metaKey)) this.back()
    else if (e.key === 'Escape') this.app.editor.focus()
    else if ((e.key === 'Backspace' || e.key === 'Delete') && e.metaKey && this.selected.size) this.trashAll([...this.selected])
    else return
    e.preventDefault()
  }

  // ------------------------------------------------------------------ actions

  async addLocation() {
    const dirs = await api.showOpenDialog({ directory: true })
    if (!dirs) return
    // Show the folder straight away; settings and indexing catch up behind it.
    this.go({ kind: 'folder', path: dirs[0] })
    await this.app.set({ libraryLocations: [...new Set([...this.app.settings.libraryLocations, ...dirs])] })
  }

  async newFolder(parent = this.saveFolder()) {
    if (!parent) return toast('Add a library folder first.')
    const name = await prompt('New Folder', 'New Folder', { okLabel: 'Create' })
    if (!name) return
    await api.mkdir(await this.app.uniquePath(`${parent}/${name.replace(/\//g, '-')}`))
    this.render()
  }

  newSmartFolder(query = '') {
    editSmartFolder(this.app, { id: crypto.randomUUID(), name: query || 'New Smart Folder', query: '', rules: [{ field: 'search', op: 'matches', value: query }], match: 'all' }, (sf) =>
      this.go({ kind: 'smart', id: sf.id })
    )
  }

  private toggleFavorite(paths: string[]) {
    const fav = this.app.settings.favorites
    const all = paths.every((p) => fav.includes(p))
    this.app.set({ favorites: all ? fav.filter((p) => !paths.includes(p)) : [...new Set([...fav, ...paths])] })
  }

  private async renamePath(path: string) {
    if (path === this.app.path) return this.app.rename()
    const name = basename(path)
    const next = await prompt('Rename', name, { okLabel: 'Rename', select: [0, name.replace(/\.[^.]+$/, '').length] })
    if (!next || next === name) return
    try {
      await api.rename(path, dirname(path) + '/' + next)
      this.app.refreshFiles()
    } catch (e: any) {
      toast(e.message, { error: true })
    }
  }

  async moveAll(paths: string[], toDir: string) {
    let moved = 0
    for (const from of paths) {
      if (dirname(from) === toDir || toDir === from || toDir.startsWith(from + '/')) continue
      const target = await this.app.uniquePath(toDir + '/' + basename(from))
      try {
        if (from === this.app.path) await this.app.relocate(target)
        else {
          const openInside = this.app.path?.startsWith(from + '/')
          const inner = openInside ? this.app.path!.slice(from.length) : ''
          if (openInside) await this.app.save()
          await api.rename(from, target)
          if (openInside) await this.app.open(target + inner)
        }
        moved++
      } catch (e: any) {
        toast(e.message, { error: true })
      }
    }
    if (moved) this.app.refreshFiles()
  }

  moveDocument(path: string) {
    return this.moveTo([path])
  }

  private async moveTo(paths: string[]) {
    const folders = (await Promise.all(this.app.settings.libraryLocations.map((l) => api.listFolders(l)))).flat()
    this.app.palette.pick(
      paths.length > 1 ? `Move ${paths.length} items to…` : `Move “${basename(paths[0])}” to…`,
      folders.map((f) => ({ label: basename(f), detail: f.replace(/^\/Users\/[^/]+/, '~'), data: f })),
      (it) => this.moveAll(paths, it.data as string)
    )
  }

  private async newFolderWithSelection(paths: string[]) {
    const parent = dirname(paths[0])
    const folder = await this.app.uniquePath(`${parent}/New Folder`)
    await api.mkdir(folder)
    await this.moveAll(paths, folder)
    const name = await prompt('Name the New Folder', 'New Folder', { okLabel: 'Rename' })
    if (name && name !== 'New Folder') await api.rename(folder, `${parent}/${name.replace(/\//g, '-')}`).catch((e) => toast(e.message, { error: true }))
    this.app.refreshFiles()
  }

  private async trashAll(paths: string[]) {
    const label = paths.length > 1 ? `${paths.length} items` : `“${basename(paths[0])}”`
    const ok = await api.confirm({ message: `Move ${label} to the Trash?`, buttons: ['Move to Trash', 'Cancel'] })
    if (ok !== 0) return
    for (const p of paths) {
      if (p === this.app.path || (this.app.path ?? '').startsWith(p + '/')) {
        this.app.saved = this.app.text
        await api.trash(p)
        this.app.path = null
        await this.app.newDocument()
      } else await api.trash(p)
    }
    this.selected.clear()
    this.app.refreshFiles()
  }

  /** "/Notes/Idea.md": the path relative to its library location, as smart folder rules use it. */
  private locationPath(path: string) {
    const loc = this.app.settings.libraryLocations.find((l) => path.startsWith(l + '/') || path === l)
    return loc ? path.slice(loc.length) || '/' : path
  }

  private itemMenu(it: Item): MenuItem[] {
    const paths = this.selected.has(it.path) ? [...this.selected] : [it.path]
    const many = paths.length > 1
    const fav = paths.every((p) => this.app.settings.favorites.includes(p))
    const items: MenuItem[] = []
    if (!many) {
      if (it.isDir) items.push({ label: 'New Document Here', action: () => this.app.newDocument(it.path) }, { label: 'New Folder…', action: () => this.newFolder(it.path) })
      else items.push({ label: 'Open', action: () => this.app.open(it.path) }, { label: 'Open in New Window', action: () => api.newWindow(it.path) })
      items.push({ separator: true, label: '' }, { label: 'Get Info', action: () => openGetInfo(this.app, it.path) }, { label: 'Rename…', action: () => this.renamePath(it.path) })
      if (!it.isDir)
        items.push({
          label: 'Duplicate',
          action: async () => {
            await api.copyFile(it.path, await this.app.uniquePath(it.path.replace(/(\.[^./]+)?$/, ' copy$1')))
            this.app.refreshFiles()
          }
        })
    }
    items.push(
      { label: 'Move To…', action: () => this.moveTo(paths) },
      { label: 'New Folder with Selection', action: () => this.newFolderWithSelection(paths) },
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => this.toggleFavorite(paths) },
      { separator: true, label: '' },
      { label: 'Copy Path', action: () => navigator.clipboard.writeText(paths.map((p) => this.locationPath(p)).join('\n')) },
      { label: 'Reveal in Finder', action: () => paths.forEach((p) => api.reveal(p)) },
      { separator: true, label: '' },
      { label: many ? `Move ${paths.length} Items to Trash` : 'Move to Trash', action: () => this.trashAll(paths) }
    )
    return items
  }

  private locationMenu(path: string): MenuItem[] {
    return [
      { label: 'New Document Here', action: () => this.app.newDocument(path) },
      { label: 'New Folder…', action: () => this.newFolder(path) },
      { separator: true, label: '' },
      { label: 'Get Info', action: () => openGetInfo(this.app, path) },
      { label: 'Reveal in Finder', action: () => api.reveal(path) },
      { separator: true, label: '' },
      { label: 'Remove from Locations', action: () => this.app.set({ libraryLocations: this.app.settings.libraryLocations.filter((l) => l !== path) }) }
    ]
  }
}

/** iA Writer's own iCloud folder reads better as "iCloud" than as "Documents". */
function locationName(path: string) {
  if (/Mobile Documents\/[^/]+~writer\/Documents$/.test(path)) return 'iCloud'
  if (/Mobile Documents\/com~apple~CloudDocs$/.test(path)) return 'iCloud Drive'
  return basename(path)
}

/** Lets the library be resized by dragging its right edge; the width is remembered per machine. */
export function sidebarResizer(sidebar: HTMLElement, app: HTMLElement) {
  const saved = Number(localStorage.getItem('fw-sidebar-w'))
  if (saved) app.style.setProperty('--fw-sidebar-w', saved + 'px')
  const handle = h('div', { class: 'sb-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize library' })
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    app.classList.add('resizing')
    const organizer = sidebar.classList.contains('with-organizer') ? (sidebar.querySelector('.sb-organizer') as HTMLElement).offsetWidth : 0
    const move = (ev: MouseEvent) => {
      const w = Math.min(520, Math.max(200, ev.clientX - organizer))
      app.style.setProperty('--fw-sidebar-w', w + 'px')
      localStorage.setItem('fw-sidebar-w', String(w))
    }
    const up = () => {
      app.classList.remove('resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
  handle.addEventListener('dblclick', () => {
    app.style.removeProperty('--fw-sidebar-w')
    localStorage.removeItem('fw-sidebar-w')
  })
  sidebar.append(handle)
}

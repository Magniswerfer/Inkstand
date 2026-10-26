// The library sidebar: locations, folders, favourites, recent files, smart folders, tags and search.
import type { FileSummary, SearchHit, Settings } from '@shared/types'
import type { App } from '../app'
import { basename, clear, debounce, dirname, h, icon, relativeTime, stripExt } from './dom'
import { contextMenu, prompt, toast, type MenuItem } from './overlay'

const api = window.api

type View =
  | { kind: 'home' }
  | { kind: 'folder'; path: string }
  | { kind: 'search'; query: string; scope?: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'smart'; id: string }

export class Library {
  private view: View = { kind: 'home' }
  private stack: View[] = []
  private list: HTMLElement
  private header: HTMLElement
  private search: HTMLInputElement
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
    this.header = h('div', { class: 'sb-header' })
    this.list = h('div', { class: 'sb-list', role: 'listbox', onkeydown: (e: KeyboardEvent) => this.onListKey(e) })
    root.append(h('div', { class: 'sb-top' }, this.search), this.header, this.list)
    const saved = localStorage.getItem('fw-library-view')
    if (saved) {
      try {
        this.view = JSON.parse(saved)
      } catch {
        // ignore
      }
    }
    if (this.view.kind === 'search') this.view = { kind: 'home' }
    // Like iA Writer, open straight into your documents rather than an overview.
    const first = app.settings.libraryLocations[0]
    if (!saved && first) this.view = { kind: 'folder', path: first }
    this.render()
  }

  onSettings(prev: Settings) {
    const s = this.app.settings
    if (prev.libraryLocations.join() !== s.libraryLocations.join()) this.app.refreshFiles()
    else if (prev.librarySort !== s.librarySort || prev.showExtensions !== s.showExtensions || prev.favorites.join() !== s.favorites.join() || prev.smartFolders !== s.smartFolders) this.render()
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

  focusSearch(text = '') {
    if (text) this.search.value = text
    this.search.focus()
    this.search.select()
    if (text) this.onSearch()
  }

  private go(view: View, push = true) {
    if (push && JSON.stringify(view) !== JSON.stringify(this.view)) this.stack.push(this.view)
    this.view = view
    if (view.kind !== 'search') localStorage.setItem('fw-library-view', JSON.stringify(view))
    this.render()
  }

  private back() {
    const v = this.view
    if (v.kind === 'folder') {
      const loc = this.app.settings.libraryLocations.find((l) => v.path.startsWith(l))
      if (loc && v.path !== loc) return this.go({ kind: 'folder', path: dirname(v.path) }, false)
    }
    if (v.kind === 'search') {
      this.search.value = ''
    }
    this.go(this.stack.pop() ?? { kind: 'home' }, false)
    if (this.view.kind === 'search') this.go({ kind: 'home' }, false)
  }

  private onSearch = debounce(() => {
    const q = this.search.value.trim()
    if (q) this.go({ kind: 'search', query: q }, this.view.kind !== 'search')
    else if (this.view.kind === 'search') this.back()
  }, 200)

  highlightCurrent() {
    for (const el of this.list.querySelectorAll<HTMLElement>('.sb-item[data-path]')) el.classList.toggle('current', el.dataset.path === this.app.path)
  }

  // ------------------------------------------------------------------ rendering

  private async render() {
    const token = ++this.renderToken
    const v = this.view
    const s = this.app.settings
    let title = 'Library'
    let items: HTMLElement[] = []
    let canBack = v.kind !== 'home'
    let footer: HTMLElement | null = null

    switch (v.kind) {
      case 'home':
        items = await this.homeItems()
        canBack = false
        break
      case 'folder': {
        title = basename(v.path)
        const entries = await api.listDir(v.path).catch(() => null)
        if (!entries) {
          items = [h('div', { class: 'sb-empty' }, 'This folder is not available.')]
          break
        }
        items = this.sorted(entries).map((e) => (e.isDir ? this.folderRow(e.path, e.name) : this.fileRow(e)))
        if (!items.length) items = [h('div', { class: 'sb-empty' }, 'No documents yet.', h('button', { class: 'link', onclick: () => this.app.newDocument(v.path) }, 'Create one'))]
        footer = h('div', { class: 'sb-footer' }, h('button', { onclick: () => this.app.newDocument(v.path), title: 'New document here' }, icon('plus'), 'New'))
        break
      }
      case 'search': {
        title = `“${v.query}”`
        const roots = s.libraryLocations
        if (!roots.length) {
          items = [h('div', { class: 'sb-empty' }, 'Add a library folder to search it.')]
          break
        }
        const hits = await api.search(roots, v.query)
        items = hits.map((hit) => this.hitRow(hit, v.query))
        if (!items.length) items = [h('div', { class: 'sb-empty' }, 'No matches.')]
        footer = h(
          'div',
          { class: 'sb-footer' },
          h('button', { onclick: () => this.saveSmartFolder(v.query) }, icon('smart'), 'Save as Smart Folder')
        )
        break
      }
      case 'tag': {
        title = '#' + v.tag
        const hits = await api.search(s.libraryLocations, '#' + v.tag)
        items = hits.map((hit) => this.hitRow(hit, '#' + v.tag))
        if (!items.length) items = [h('div', { class: 'sb-empty' }, 'No documents with this tag.')]
        break
      }
      case 'favorites': {
        title = 'Favorites'
        const stats = await Promise.all(s.favorites.map((p) => api.stat(p)))
        items = stats.filter((x) => x).map((st) => (st!.isDir ? this.folderRow(st!.path, st!.name) : this.fileRow({ ...st!, title: stripExt(st!.name), excerpt: '', tags: [] })))
        if (!items.length) items = [h('div', { class: 'sb-empty' }, 'Right-click a document or folder to add it to Favorites.')]
        break
      }
      case 'recent': {
        title = 'Recent'
        const stats = await Promise.all(s.recent.map((p) => api.stat(p)))
        items = stats.filter((x) => x && !x.isDir).map((st) => this.fileRow({ ...st!, title: stripExt(st!.name), excerpt: dirname(st!.path).replace(/^\/Users\/[^/]+/, '~'), tags: [] }))
        break
      }
      case 'smart': {
        const sf = s.smartFolders.find((f) => f.id === v.id)
        if (!sf) return this.go({ kind: 'home' }, false)
        title = sf.name
        const hits = await api.search(s.libraryLocations, sf.query)
        items = hits.map((hit) => this.hitRow(hit, sf.query))
        if (!items.length) items = [h('div', { class: 'sb-empty' }, 'Nothing matches this smart folder yet.')]
        break
      }
    }
    if (token !== this.renderToken) return

    clear(this.header)
    this.header.append(
      canBack ? h('button', { class: 'fw-icon-btn', 'aria-label': 'Back', onclick: () => this.back() }, icon('back')) : h('span', { class: 'sb-spacer' }),
      h('h3', { title: v.kind === 'folder' ? v.path : '' }, title),
      h('button', { class: 'fw-icon-btn', 'aria-label': 'New document', title: 'New document', onclick: () => this.app.newDocument(this.saveFolder() ?? undefined) }, icon('plus'))
    )
    clear(this.list)
    this.list.append(...items)
    if (footer) this.list.append(footer)
    this.highlightCurrent()
  }

  private sorted(entries: FileSummary[]) {
    const sort = this.app.settings.librarySort
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      if (sort === 'name' || a.isDir) return a.name.localeCompare(b.name, undefined, { numeric: true })
      if (sort === 'created') return b.ctime - a.ctime
      return b.mtime - a.mtime
    })
  }

  private async homeItems(): Promise<HTMLElement[]> {
    const s = this.app.settings
    const out: HTMLElement[] = []
    out.push(h('div', { class: 'sb-section' }, 'Locations'))
    for (const loc of s.libraryLocations) out.push(this.folderRow(loc, basename(loc), true))
    out.push(h('button', { class: 'sb-item sb-add', onclick: () => this.addLocation() }, icon('plus'), h('span', { class: 'name' }, 'Add Folder…')))
    out.push(h('div', { class: 'sb-section' }, 'Library'))
    out.push(this.navRow('star', 'Favorites', { kind: 'favorites' }, s.favorites.length))
    out.push(this.navRow('clock', 'Recent', { kind: 'recent' }, s.recent.length))
    if (s.smartFolders.length) {
      out.push(h('div', { class: 'sb-section' }, 'Smart Folders'))
      for (const sf of s.smartFolders) {
        const row = this.navRow('smart', sf.name, { kind: 'smart', id: sf.id })
        row.addEventListener('contextmenu', (e) =>
          contextMenu(e, [
            { label: 'Rename…', action: async () => {
              const name = await prompt('Rename Smart Folder', sf.name)
              if (name) this.app.set({ smartFolders: s.smartFolders.map((f) => (f.id === sf.id ? { ...f, name } : f)) })
            } },
            { label: 'Edit Search…', action: async () => {
              const query = await prompt('Smart Folder Search', sf.query, { label: 'Words, "phrases", #tags and -exclusions:' })
              if (query) this.app.set({ smartFolders: s.smartFolders.map((f) => (f.id === sf.id ? { ...f, query } : f)) })
            } },
            { label: 'Delete', action: () => this.app.set({ smartFolders: s.smartFolders.filter((f) => f.id !== sf.id) }) }
          ])
        )
        out.push(row)
      }
    }
    const tags = await api.tags(s.libraryLocations).catch(() => [])
    if (tags.length) {
      out.push(h('div', { class: 'sb-section' }, 'Tags'))
      for (const t of tags) out.push(this.navRow('tag', t.tag, { kind: 'tag', tag: t.tag }, t.count))
    }
    if (!s.libraryLocations.length) {
      out.push(
        h(
          'div',
          { class: 'sb-empty' },
          'Your library is a set of ordinary folders on disk. Add one to browse, search and save your documents there.'
        )
      )
    }
    return out
  }

  private navRow(ic: Parameters<typeof icon>[0], label: string, view: View, count?: number) {
    return h(
      'button',
      { class: 'sb-item sb-nav', onclick: () => this.go(view) },
      icon(ic),
      h('span', { class: 'name' }, label),
      count != null ? h('span', { class: 'count' }, String(count)) : null
    )
  }

  private folderRow(path: string, name: string, isLocation = false) {
    const row = h(
      'button',
      {
        class: 'sb-item sb-folder',
        'data-dir': path,
        onclick: () => this.go({ kind: 'folder', path }),
        ondragover: (e: DragEvent) => {
          if (e.dataTransfer?.types.includes('application/x-fw-path')) {
            e.preventDefault()
            row.classList.add('drop')
          }
        },
        ondragleave: () => row.classList.remove('drop'),
        ondrop: (e: DragEvent) => {
          row.classList.remove('drop')
          const from = e.dataTransfer?.getData('application/x-fw-path')
          if (from) this.move(from, path)
        }
      },
      icon('folder'),
      h('span', { class: 'name' }, name)
    )
    row.addEventListener('contextmenu', (e) => contextMenu(e, this.folderMenu(path, isLocation)))
    return row
  }

  private fileRow(e: FileSummary) {
    const s = this.app.settings
    const name = s.showExtensions ? e.name : stripExt(e.name)
    const row = h(
      'button',
      {
        class: 'sb-item sb-file',
        'data-path': e.path,
        draggable: 'true',
        onclick: () => this.app.open(e.path),
        ondragstart: (ev: DragEvent) => ev.dataTransfer?.setData('application/x-fw-path', e.path)
      },
      h('span', { class: 'name' }, e.title && e.title !== stripExt(e.name) && s.librarySort !== 'name' ? e.title : name),
      h('span', { class: 'meta' }, relativeTime(e.mtime), e.excerpt ? ' — ' + e.excerpt : ''),
      s.favorites.includes(e.path) ? h('span', { class: 'fav', 'aria-label': 'Favorite' }, '★') : null
    )
    row.addEventListener('contextmenu', (ev) => contextMenu(ev, this.fileMenu(e.path)))
    return row
  }

  private hitRow(hit: SearchHit, query: string) {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t && !t.startsWith('-')).map((t) => t.replace(/^"|"$/g, ''))
    const snippet = h('span', { class: 'meta' })
    const rest = hit.snippet
    // Bold the first matching term in the snippet.
    const lower = rest.toLowerCase()
    const term = terms.find((t) => lower.includes(t))
    if (term) {
      const i = lower.indexOf(term)
      snippet.append(rest.slice(0, i), h('mark', null, rest.slice(i, i + term.length)), rest.slice(i + term.length))
    } else snippet.append(rest)
    const row = h(
      'button',
      { class: 'sb-item sb-file', 'data-path': hit.path, onclick: () => this.app.open(hit.path, { line: hit.line }) },
      h('span', { class: 'name' }, hit.title || stripExt(hit.name)),
      snippet
    )
    row.addEventListener('contextmenu', (ev) => contextMenu(ev, this.fileMenu(hit.path)))
    return row
  }

  private onListKey(e: KeyboardEvent) {
    const items = [...this.list.querySelectorAll<HTMLElement>('.sb-item')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' && i < items.length - 1) items[i + 1].focus()
    else if (e.key === 'ArrowUp') (i > 0 ? items[i - 1] : this.search).focus()
    else if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && e.metaKey)) this.back()
    else if (e.key === 'Escape') this.app.editor.focus()
    else return
    e.preventDefault()
  }

  // ------------------------------------------------------------------ actions

  async addLocation() {
    const dirs = await api.showOpenDialog({ directory: true })
    if (!dirs) return
    const locs = [...new Set([...this.app.settings.libraryLocations, ...dirs])]
    await this.app.set({ libraryLocations: locs })
    this.go({ kind: 'folder', path: dirs[0] })
  }

  async newFolder(parent = this.saveFolder()) {
    if (!parent) return toast('Add a library folder first.')
    const name = await prompt('New Folder', 'New Folder', { okLabel: 'Create' })
    if (!name) return
    const path = await this.app.uniquePath(`${parent}/${name.replace(/\//g, '-')}`)
    await api.mkdir(path)
    this.go({ kind: 'folder', path: parent }, false)
  }

  private async saveSmartFolder(query: string) {
    const name = await prompt('New Smart Folder', query, { okLabel: 'Save' })
    if (!name) return
    await this.app.set({ smartFolders: [...this.app.settings.smartFolders, { id: crypto.randomUUID(), name, query }] })
    toast(`Saved “${name}”.`)
  }

  private toggleFavorite(path: string) {
    const fav = this.app.settings.favorites
    this.app.set({ favorites: fav.includes(path) ? fav.filter((p) => p !== path) : [...fav, path] })
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

  private async move(from: string, toDir: string) {
    if (dirname(from) === toDir || toDir.startsWith(from + '/')) return
    const target = toDir + '/' + basename(from)
    try {
      if (from === this.app.path) await this.app.save()
      await api.rename(from, target)
      if (from === this.app.path) await this.app.open(target)
      this.app.refreshFiles()
    } catch (e: any) {
      toast(e.message, { error: true })
    }
  }

  private async trash(path: string) {
    const ok = await api.confirm({ message: `Move “${basename(path)}” to the Trash?`, buttons: ['Move to Trash', 'Cancel'] })
    if (ok !== 0) return
    if (path === this.app.path || (this.app.path ?? '').startsWith(path + '/')) {
      this.app.saved = this.app.text
      await api.trash(path)
      this.app.path = null
      await this.app.newDocument()
    } else await api.trash(path)
    this.app.refreshFiles()
  }

  private fileMenu(path: string): MenuItem[] {
    const fav = this.app.settings.favorites.includes(path)
    return [
      { label: 'Open', action: () => this.app.open(path) },
      { label: 'Open in New Window', action: () => api.newWindow(path) },
      { separator: true, label: '' },
      { label: 'Rename…', action: () => this.renamePath(path) },
      {
        label: 'Duplicate',
        action: async () => {
          await api.copyFile(path, await this.app.uniquePath(path.replace(/(\.[^./]+)?$/, ' copy$1')))
          this.app.refreshFiles()
        }
      },
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => this.toggleFavorite(path) },
      { label: 'Reveal in Finder', action: () => api.reveal(path) },
      { separator: true, label: '' },
      { label: 'Move to Trash', action: () => this.trash(path) }
    ]
  }

  private folderMenu(path: string, isLocation: boolean): MenuItem[] {
    const fav = this.app.settings.favorites.includes(path)
    const items: MenuItem[] = [
      { label: 'New Document Here', action: () => this.app.newDocument(path) },
      { label: 'New Folder…', action: () => this.newFolder(path) },
      { separator: true, label: '' },
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => this.toggleFavorite(path) },
      { label: 'Reveal in Finder', action: () => api.reveal(path) }
    ]
    if (isLocation) {
      items.push({ separator: true, label: '' }, {
        label: 'Remove from Library',
        action: () => this.app.set({ libraryLocations: this.app.settings.libraryLocations.filter((l) => l !== path) })
      })
    } else {
      items.push({ label: 'Rename…', action: () => this.renamePath(path) }, { separator: true, label: '' }, { label: 'Move to Trash', action: () => this.trash(path) })
    }
    return items
  }
}

/** Lets the sidebar be resized by dragging its right edge; the width is remembered per machine. */
export function sidebarResizer(sidebar: HTMLElement, app: HTMLElement) {
  const saved = Number(localStorage.getItem('fw-sidebar-w'))
  if (saved) app.style.setProperty('--fw-sidebar-w', saved + 'px')
  const handle = h('div', { class: 'sb-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize library' })
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    app.classList.add('resizing')
    const move = (ev: MouseEvent) => {
      const w = Math.min(480, Math.max(200, ev.clientX))
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

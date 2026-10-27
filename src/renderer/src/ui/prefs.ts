// Settings window.
import type { Author, CustomPattern, PublishAccount, Settings } from '@shared/types'
import type { App } from '../app'
import { clear, h } from './dom'
import { modal, toast } from './overlay'

const api = window.api
type Key = keyof Settings

function row(label: string, control: HTMLElement, help?: string) {
  return h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, label), h('span', { class: 'pf-control' }, control, help ? h('small', null, help) : null))
}

export function openPreferences(app: App, initialTab = 'general') {
  const s = () => app.settings
  const set = (patch: Partial<Settings>) => app.set(patch)

  const select = <K extends Key>(key: K, options: [Settings[K], string][]) => {
    const el = h('select', { onchange: () => set({ [key]: options[el.selectedIndex][0] } as Partial<Settings>) }, options.map(([v, l]) => h('option', { selected: s()[key] === v }, l)))
    return el
  }
  const check = (get: () => boolean, put: (v: boolean) => Partial<Settings>) => {
    const el = h('input', { type: 'checkbox', checked: get(), onchange: () => set(put(el.checked)) })
    return el
  }
  const bool = (key: Key) => check(() => s()[key] as boolean, (v) => ({ [key]: v }))
  const num = (key: Key, min: number, max: number, step = 1) => {
    const el = h('input', { type: 'number', min, max, step, value: String(s()[key]), onchange: () => set({ [key]: Math.min(max, Math.max(min, Number(el.value))) }) })
    return el
  }
  const text = (key: Key, placeholder = '') => {
    const el = h('input', { type: 'text', value: String(s()[key] ?? ''), placeholder, onchange: () => set({ [key]: el.value }) })
    return el
  }

  const tabs: Record<string, [string, () => HTMLElement]> = {
    general: [
      'General',
      () =>
        h(
          'div',
          null,
          row('Appearance', select('theme', [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']])),
          row('Font', select('font', [['duo', 'Duo'], ['mono', 'Mono'], ['sans', 'Sans'], ['serif', 'Serif'], ['custom', 'Custom…']])),
          row('Custom font', text('customFont', 'e.g. Literata'), 'Any font installed on your computer.'),
          row('Font size', num('fontSize', 10, 40)),
          row('Line height', num('lineHeight', 1, 2.5, 0.05)),
          row('Line width', select('lineWidth', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide'], ['full', 'Full width']])),
          row('Markdown markup', select('markup', [['dim', 'Dim'], ['show', 'Show'], ['hide', 'Hide when not editing']])),
          row('Hanging heading marks', bool('hangingHeadings'), 'Put # marks in the left margin so headings line up with text.'),
          row('Show stats', bool('showStats')),
          row('Reading speed', num('wordsPerMinute', 100, 600, 10), 'Words per minute, for reading time.'),
          row('Speaking speed', num('speakingWordsPerMinute', 60, 300, 5), 'Words per minute, for speaking time.'),
          row('Words per page', num('wordsPerPage', 100, 800, 5)),
          row('Autosave', bool('autosave'), 'Save changes automatically as you write.'),
          row('New file extension', select('defaultExtension', [['md', '.md'], ['markdown', '.markdown'], ['txt', '.txt']]))
        )
    ],
    writing: [
      'Writing',
      () =>
        h(
          'div',
          null,
          row('Focus mode', select('focusMode', [['off', 'Off'], ['sentence', 'Sentence'], ['paragraph', 'Paragraph'], ['line', 'Line']])),
          row('Typewriter mode', bool('typewriter'), 'Keep the current line in the middle of the window.'),
          row('Smart quotes', bool('smartQuotes')),
          row('Smart dashes and ellipses', bool('smartDashes'), '-- becomes —, ... becomes …'),
          row('Auto-pair brackets and quotes', bool('autoPair')),
          row('Check spelling', bool('spellcheck')),
          row('Paste rich text as Markdown', bool('pasteRichText')),
          row('Show images inline', bool('inlineImages')),
          row('Dropped files insert', select('dropInsert', [['block', 'Content blocks (/file.png)'], ['markdown', 'Markdown images']])),
          row('Assets folder', text('assetsFolder'), 'Dropped files from elsewhere are copied here, next to the document.')
        )
    ],
    style: ['Syntax & Style', () => styleTab(app)],
    templates: ['Templates', () => templatesTab(app)],
    library: [
      'Library',
      () =>
        h(
          'div',
          null,
          locationsEditor(app),
          row('Sort documents by', select('librarySort', [['modified', 'Date modified'], ['created', 'Date created'], ['name', 'Name']])),
          row('Show file extensions', bool('showExtensions')),
          h('h4', null, 'Version history'),
          row('Keep versions', check(() => s().versions.enabled, (v) => ({ versions: { ...s().versions, enabled: v } }))),
          row('Snapshot every', (() => {
            const el = h('input', { type: 'number', min: 1, max: 240, value: String(s().versions.intervalMinutes), onchange: () => set({ versions: { ...s().versions, intervalMinutes: Number(el.value) || 10 } }) })
            return el
          })(), 'Minutes between automatic snapshots while you write.'),
          row('Keep at most', (() => {
            const el = h('input', { type: 'number', min: 10, max: 5000, value: String(s().versions.max), onchange: () => set({ versions: { ...s().versions, max: Number(el.value) || 200 } }) })
            return el
          })(), 'Automatic versions per document. Named versions are always kept.')
        )
    ],
    authorship: ['Authorship', () => authorshipTab(app)],
    publishing: ['Publishing', () => accountsTab(app)]
  }

  const nav = h('nav', { class: 'pf-tabs' })
  const body = h('div', { class: 'pf-body' })
  const show = (id: string) => {
    clear(body)
    body.append(tabs[id][1]())
    for (const b of nav.children) b.classList.toggle('active', (b as HTMLElement).dataset.tab === id)
  }
  for (const [id, [label]] of Object.entries(tabs)) nav.append(h('button', { 'data-tab': id, onclick: () => show(id) }, label))
  modal('Settings', h('div', { class: 'pf' }, nav, body), { wide: true })
  show(tabs[initialTab] ? initialTab : 'general')
}

function authorshipTab(app: App) {
  const wrap = h('div')
  const a = () => app.settings.authorship
  const put = (patch: Partial<Settings['authorship']>) => app.set({ authorship: { ...a(), ...patch } }).then(render)
  function render() {
    clear(wrap)
    const pasteSel = h(
      'select',
      { onchange: () => put({ pasteAuthor: pasteSel.value }) },
      h('option', { value: '', selected: a().pasteAuthor === '' }, `${a().author || 'Me'} (don’t track pastes)`),
      a().authors.map((x) => h('option', { value: x.id, selected: a().pasteAuthor === x.id }, x.name))
    )
    const name = h('input', { type: 'text', value: a().author, placeholder: 'Me', onchange: () => put({ author: name.value }) })
    wrap.append(
      h('p', { class: 'pf-intro' }, 'FOSS Write keeps track of who wrote what. Text you type is yours. Pasted text is credited to the author you choose below, and Edit → Authorship → Mark As credits a selection to anyone.'),
      row('Track authorship', h('input', { type: 'checkbox', checked: a().enabled, onchange: (e: Event) => put({ enabled: (e.target as HTMLInputElement).checked }) })),
      row('Show authors', h('input', { type: 'checkbox', checked: a().showBorrowed, onchange: (e: Event) => put({ showBorrowed: (e.target as HTMLInputElement).checked }) }), 'Colour text written by others.'),
      row(
        'Store in the document',
        h('input', { type: 'checkbox', checked: a().storeInFile, onchange: (e: Event) => put({ storeInFile: (e.target as HTMLInputElement).checked }) }),
        'Adds a hidden comment at the end of documents that contain text by others, so authorship syncs with the file. Otherwise it stays on this computer.'
      ),
      row('Your name', name),
      row('Credit pasted text to', pasteSel),
      h('h4', null, 'Authors')
    )
    for (const au of a().authors) {
      const update = (patch: Partial<Author>) => put({ authors: a().authors.map((x) => (x.id === au.id ? { ...x, ...patch } : x)) })
      const kind = h('select', { onchange: () => update({ kind: kind.value as Author['kind'] }) }, (['human', 'ai', 'reference'] as const).map((k) => h('option', { value: k, selected: au.kind === k }, k === 'ai' ? 'AI' : k === 'human' ? 'Person' : 'Reference')))
      wrap.append(
        h(
          'div',
          { class: 'pf-pattern' },
          h('input', { type: 'color', value: au.color, title: 'Colour', onchange: (e: Event) => update({ color: (e.target as HTMLInputElement).value }) }),
          h('input', { type: 'text', value: au.name, onchange: (e: Event) => update({ name: (e.target as HTMLInputElement).value.trim() || au.name }) }),
          kind,
          h('button', { onclick: () => put({ authors: a().authors.filter((x) => x.id !== au.id), pasteAuthor: a().pasteAuthor === au.id ? '' : a().pasteAuthor }) }, 'Remove')
        )
      )
    }
    wrap.append(h('div', { class: 'fw-actions left' }, h('button', { onclick: async () => (await app.newAuthor(), render()) }, 'Add Author…')))
  }
  render()
  return wrap
}

function locationsEditor(app: App) {
  const wrap = h('div', { class: 'pf-block' })
  const render = () => {
    clear(wrap)
    wrap.append(h('h4', null, 'Library folders'))
    const locs = app.settings.libraryLocations
    if (!locs.length) wrap.append(h('p', { class: 'pf-intro' }, 'No folders yet.'))
    for (const l of locs) {
      wrap.append(
        h('div', { class: 'pf-list-row' }, h('span', null, l), h('button', { onclick: async () => (await app.set({ libraryLocations: locs.filter((x) => x !== l) }), render()) }, 'Remove'))
      )
    }
    wrap.append(h('button', { onclick: async () => (await app.library.addLocation(), render()) }, 'Add Folder…'))
  }
  render()
  return wrap
}

function styleTab(app: App) {
  const s = () => app.settings
  const wrap = h('div')
  const render = () => {
    clear(wrap)
    const syn = s().syntax
    const sc = s().styleCheck
    wrap.append(
      h('h4', null, 'Syntax highlight'),
      h('p', { class: 'pf-intro' }, 'Colour parts of speech to see the structure of your sentences (English).'),
      ...(['adjectives', 'nouns', 'adverbs', 'verbs', 'conjunctions'] as const).map((k) =>
        row(k[0].toUpperCase() + k.slice(1), h('input', { type: 'checkbox', checked: syn[k], onchange: (e: Event) => app.set({ syntax: { ...syn, [k]: (e.target as HTMLInputElement).checked } }) }), undefined)
      ),
      h('h4', null, 'Style check'),
      h('p', { class: 'pf-intro' }, 'Underline phrases you may want to cut or rewrite. Hover a phrase to replace or ignore it.'),
      row('Fillers', h('input', { type: 'checkbox', checked: sc.fillers, onchange: (e: Event) => app.set({ styleCheck: { ...sc, fillers: (e.target as HTMLInputElement).checked } }) }), '“just”, “really”, “very”…'),
      row('Clichés', h('input', { type: 'checkbox', checked: sc.cliches, onchange: (e: Event) => app.set({ styleCheck: { ...sc, cliches: (e.target as HTMLInputElement).checked } }) }), '“at the end of the day”…'),
      row('Redundancies', h('input', { type: 'checkbox', checked: sc.redundancies, onchange: (e: Event) => app.set({ styleCheck: { ...sc, redundancies: (e.target as HTMLInputElement).checked } }) }), '“end result”, “free gift”…'),
      h('h4', null, 'Custom patterns'),
      h('p', { class: 'pf-intro' }, 'Words or regular expressions you want to watch for — house style, overused words, or placeholders like TODO.')
    )
    const update = (id: string, patch: Partial<CustomPattern>) => app.set({ styleCheck: { ...sc, custom: sc.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) } })
    for (const c of sc.custom) {
      let valid = true
      if (c.isRegex) {
        try {
          new RegExp(c.pattern, 'u')
        } catch {
          valid = false
        }
      }
      wrap.append(
        h(
          'div',
          { class: `pf-pattern ${valid ? '' : 'invalid'}` },
          h('input', { type: 'checkbox', checked: c.enabled, title: 'Enabled', onchange: (e: Event) => update(c.id, { enabled: (e.target as HTMLInputElement).checked }) }),
          h('input', { type: 'text', value: c.pattern, placeholder: 'Pattern', spellcheck: 'false', onchange: (e: Event) => update(c.id, { pattern: (e.target as HTMLInputElement).value }).then(render) }),
          h('input', { type: 'text', value: c.note, placeholder: 'Note shown on hover', onchange: (e: Event) => update(c.id, { note: (e.target as HTMLInputElement).value }) }),
          h('label', { title: 'Regular expression' }, h('input', { type: 'checkbox', checked: c.isRegex, onchange: (e: Event) => update(c.id, { isRegex: (e.target as HTMLInputElement).checked }).then(render) }), ' Regex'),
          h('label', { title: 'Case sensitive' }, h('input', { type: 'checkbox', checked: c.caseSensitive, onchange: (e: Event) => update(c.id, { caseSensitive: (e.target as HTMLInputElement).checked }) }), ' Aa'),
          h('button', { onclick: () => app.set({ styleCheck: { ...sc, custom: sc.custom.filter((x) => x.id !== c.id) } }).then(render) }, 'Remove')
        )
      )
    }
    wrap.append(
      h(
        'button',
        {
          onclick: () =>
            app
              .set({ styleCheck: { ...sc, custom: [...sc.custom, { id: crypto.randomUUID(), pattern: '', isRegex: false, caseSensitive: false, note: '', enabled: true }] } })
              .then(render)
        },
        'Add Pattern'
      )
    )
    if (sc.ignored.length) {
      wrap.append(h('h4', null, 'Ignored phrases'))
      for (const p of sc.ignored)
        wrap.append(h('div', { class: 'pf-list-row' }, h('span', null, p), h('button', { onclick: () => app.set({ styleCheck: { ...sc, ignored: sc.ignored.filter((x) => x !== p) } }).then(render) }, 'Stop Ignoring')))
    }
  }
  render()
  return wrap
}

function templatesTab(app: App) {
  const wrap = h('div')
  const render = async () => {
    const templates = await app.preview.loadTemplates()
    clear(wrap)
    const sel = (key: 'previewTemplate' | 'exportTemplate') => {
      const el = h('select', { onchange: () => app.set({ [key]: templates[el.selectedIndex].id }) }, templates.map((t) => h('option', { selected: app.settings[key] === t.id }, t.name)))
      return el
    }
    wrap.append(
      row('Preview template', sel('previewTemplate')),
      row('Export template', sel('exportTemplate'), 'Used for PDF, HTML, printing and rich-text copy.'),
      row(
        'PDF paper size',
        (() => {
          const opts = ['A4', 'Letter', 'Legal', 'A5'] as const
          const el = h('select', { onchange: () => app.set({ pdfPaper: opts[el.selectedIndex] }) }, opts.map((o) => h('option', { selected: app.settings.pdfPaper === o }, o)))
          return el
        })()
      ),
      h('h4', null, 'Installed templates')
    )
    for (const t of templates) {
      wrap.append(
        h(
          'div',
          { class: 'pf-list-row' },
          h('span', null, h('strong', null, t.name), t.description ? ' — ' + t.description : '', t.author ? h('small', null, ` by ${t.author}`) : ''),
          t.builtIn ? h('small', null, 'Built in') : h('button', { onclick: async () => (await api.removeTemplate(t.id), render()) }, 'Remove')
        )
      )
    }
    wrap.append(
      h(
        'div',
        { class: 'fw-actions left' },
        h('button', { onclick: async () => {
          try {
            const t = await api.importTemplate()
            if (t) toast(`Installed “${t.name}”.`)
            render()
          } catch (e: any) {
            toast(e.message, { error: true })
          }
        } }, 'Import Template…'),
        h('button', { onclick: () => api.revealTemplates() }, 'Open Templates Folder')
      ),
      h('p', { class: 'pf-intro' }, 'Templates are folders of HTML and CSS. FOSS Write reads its own format (template.json) and iA Writer .iatemplate bundles.')
    )
  }
  render()
  return wrap
}

const KINDS: Record<PublishAccount['kind'], { name: string; url: string; user: boolean; secret: string; help: string }> = {
  wordpress: { name: 'WordPress', url: 'Site URL', user: true, secret: 'Application password', help: 'Create an application password under Users → Profile in WordPress.' },
  ghost: { name: 'Ghost', url: 'Site URL', user: false, secret: 'Admin API key', help: 'Create a custom integration under Settings → Integrations to get an Admin API key.' },
  medium: { name: 'Medium', url: '', user: false, secret: 'Integration token', help: 'Medium no longer issues new tokens, but existing ones still work.' },
  microblog: { name: 'Micro.blog', url: 'Micropub endpoint (optional)', user: false, secret: 'App token', help: 'Create a token under Account → Edit Apps on Micro.blog.' }
}

function accountsTab(app: App) {
  const wrap = h('div')
  const render = () => {
    clear(wrap)
    wrap.append(h('p', { class: 'pf-intro' }, 'Publish drafts straight to your blog. Secrets are encrypted with your system keychain.'))
    for (const a of app.settings.publishAccounts) {
      wrap.append(
        h(
          'div',
          { class: 'pf-list-row' },
          h('span', null, h('strong', null, a.name), ` — ${KINDS[a.kind].name}${a.url ? ' · ' + a.url : ''}`),
          h('span', null, h('button', { onclick: () => edit(a) }, 'Edit'), ' ', h('button', { onclick: () => app.set({ publishAccounts: app.settings.publishAccounts.filter((x) => x.id !== a.id) }).then(render) }, 'Remove'))
        )
      )
    }
    const kind = h('select', null, Object.entries(KINDS).map(([k, v]) => h('option', { value: k }, v.name)))
    wrap.append(h('div', { class: 'fw-actions left' }, kind, h('button', { onclick: () => edit({ id: crypto.randomUUID(), kind: kind.value as PublishAccount['kind'], name: KINDS[kind.value as PublishAccount['kind']].name, url: '', username: '', secret: '' }) }, 'Add Account…')))
  }
  const edit = (a: PublishAccount) => {
    const k = KINDS[a.kind]
    const name = h('input', { type: 'text', value: a.name })
    const url = h('input', { type: 'url', value: a.url, placeholder: 'https://' })
    const user = h('input', { type: 'text', value: a.username })
    const secret = h('input', { type: 'password', placeholder: a.secret ? 'Unchanged' : '' })
    const form = h(
      'form',
      {
        class: 'fw-prompt',
        onsubmit: async (e: Event) => {
          e.preventDefault()
          await api.saveAccount({ id: a.id, kind: a.kind, name: name.value, url: url.value, username: user.value, secret: secret.value || undefined })
          app.settings = await api.getSettings()
          m.close()
          render()
        }
      },
      row('Name', name),
      k.url ? row(k.url, url) : null,
      k.user ? row('Username', user) : null,
      row(k.secret, secret, k.help),
      h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, 'Save'))
    )
    const m = modal(`${k.name} Account`, form)
  }
  render()
  return wrap
}

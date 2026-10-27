// Smart folder editor: a name and a list of rules, matched all or any.
import type { SmartField, SmartFolder, SmartOp, SmartRule } from '@shared/types'
import type { App } from '../app'
import { clear, debounce, h } from './dom'
import { modal } from './overlay'

const api = window.api

const FIELDS: [SmartField, string][] = [
  ['search', 'Search'],
  ['ancestorPath', 'Ancestor path'],
  ['parentPath', 'Parent path'],
  ['dateModified', 'Date modified'],
  ['dateCreated', 'Date created'],
  ['kind', 'Kind'],
  ['extension', 'Extension']
]

const OPS: Record<SmartField, [SmartOp, string][]> = {
  search: [['matches', 'matches']],
  ancestorPath: [['is', 'is'], ['isNot', 'is not']],
  parentPath: [['is', 'is'], ['isNot', 'is not']],
  dateModified: [['inPast', 'is in the past (days)'], ['notInPast', 'is not in the past (days)'], ['after', 'is after'], ['before', 'is before']],
  dateCreated: [['inPast', 'is in the past (days)'], ['notInPast', 'is not in the past (days)'], ['after', 'is after'], ['before', 'is before']],
  kind: [['is', 'is'], ['isNot', 'is not']],
  extension: [['is', 'is'], ['isNot', 'is not']]
}

const DEFAULTS: Record<SmartField, string> = { search: '', ancestorPath: '/', parentPath: '/', dateModified: '7', dateCreated: '7', kind: 'text', extension: 'md' }

export function editSmartFolder(app: App, initial: SmartFolder, onSaved?: (sf: SmartFolder) => void) {
  const sf: SmartFolder = { ...initial, rules: initial.rules?.length ? initial.rules.map((r) => ({ ...r })) : [{ field: 'search', op: 'matches', value: initial.query }], match: initial.match ?? 'all' }
  const name = h('input', { type: 'text', value: sf.name, 'aria-label': 'Name' })
  const match = h('select', { onchange: () => ((sf.match = match.value as 'all' | 'any'), preview()) }, h('option', { value: 'all', selected: sf.match === 'all' }, 'all'), h('option', { value: 'any', selected: sf.match === 'any' }, 'any'))
  const rulesEl = h('div', { class: 'sf-rules' })
  const count = h('p', { class: 'pf-intro' })

  const preview = debounce(async () => {
    const hits = await api.smartFolder(app.settings.libraryLocations, sf)
    count.textContent = `${hits.length === 1000 ? '1,000+' : hits.length.toLocaleString()} matching ${hits.length === 1 ? 'item' : 'items'}`
  }, 300)

  const renderRules = () => {
    clear(rulesEl)
    sf.rules!.forEach((rule: SmartRule, i) => {
      const field = h('select', { onchange: () => ((rule.field = field.value as SmartField), (rule.op = OPS[rule.field][0][0]), (rule.value = DEFAULTS[rule.field]), renderRules(), preview()) }, FIELDS.map(([f, l]) => h('option', { value: f, selected: rule.field === f }, l)))
      const op = h('select', { onchange: () => ((rule.op = op.value as SmartOp), (rule.value = rule.op === 'after' || rule.op === 'before' ? new Date().toISOString().slice(0, 10) : rule.value), renderRules(), preview()) }, OPS[rule.field].map(([o, l]) => h('option', { value: o, selected: rule.op === o }, l)))
      let value: HTMLInputElement | HTMLSelectElement
      if (rule.field === 'kind') value = h('select', { onchange: () => ((rule.value = value.value), preview()) }, (['text', 'folder', 'other'] as const).map((k) => h('option', { value: k, selected: rule.value === k }, k)))
      else
        value = h('input', {
          type: rule.op === 'after' || rule.op === 'before' ? 'date' : rule.op === 'inPast' || rule.op === 'notInPast' ? 'number' : 'text',
          value: rule.value,
          spellcheck: 'false',
          placeholder: rule.field === 'search' ? 'words "phrases" #tags -exclude' : rule.field.endsWith('Path') ? '/Folder' : '',
          oninput: () => ((rule.value = value.value), preview())
        })
      rulesEl.append(
        h(
          'div',
          { class: 'pf-pattern' },
          field,
          op,
          value,
          h('button', { title: 'Remove rule', disabled: sf.rules!.length === 1, onclick: () => (sf.rules!.splice(i, 1), renderRules(), preview()) }, '−'),
          h('button', { title: 'Add rule', onclick: () => (sf.rules!.splice(i + 1, 0, { field: 'dateModified', op: 'inPast', value: '7' }), renderRules(), preview()) }, '+')
        )
      )
    })
  }

  const form = h(
    'form',
    {
      class: 'fw-prompt',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        const saved: SmartFolder = { ...sf, name: name.value.trim() || 'Smart Folder', query: sf.rules!.find((r) => r.field === 'search')?.value ?? '' }
        const list = app.settings.smartFolders
        await app.set({ smartFolders: list.some((f) => f.id === saved.id) ? list.map((f) => (f.id === saved.id ? saved : f)) : [...list, saved] })
        m.close()
        onSaved?.(saved)
      }
    },
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Name'), name),
    h('div', { class: 'sf-match' }, 'Include items that match ', match, ' of these rules:'),
    rulesEl,
    count,
    h('p', { class: 'pf-intro' }, 'Paths are relative to a library location, so “/Notes” means the Notes folder in any location.'),
    h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, 'Save'))
  )
  renderRules()
  preview()
  const isNew = !app.settings.smartFolders.some((f) => f.id === initial.id)
  const m = modal(isNew ? 'New Smart Folder' : 'Edit Smart Folder', form, { wide: true })
  name.focus()
  name.select()
}

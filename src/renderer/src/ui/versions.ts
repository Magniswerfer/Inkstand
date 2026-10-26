// Version history: browse snapshots, compare with the current text, restore.
import { diffWordsWithSpace } from 'diff'
import type { VersionInfo } from '@shared/types'
import type { App } from '../app'
import { clear, h } from './dom'
import { modal, toast } from './overlay'

const api = window.api

export async function openVersions(app: App) {
  if (!app.path) return toast('Save the document first to keep versions.')
  const path = app.path
  await app.save()
  const versions = await api.listVersions(path)
  const list = h('div', { class: 'vs-list', role: 'listbox' })
  const view = h('div', { class: 'vs-diff' })
  const actions = h('div', { class: 'fw-actions' })
  let selected: { info: VersionInfo; text: string } | null = null

  const show = async (info: VersionInfo, el: HTMLElement) => {
    for (const c of list.children) c.classList.remove('active')
    el.classList.add('active')
    const text = await api.readVersion(path, info.id)
    selected = { info, text }
    clear(view)
    const parts = diffWordsWithSpace(text, app.text)
    const changes = parts.filter((p) => p.added || p.removed).length
    view.append(h('p', { class: 'vs-summary' }, changes ? `${changes} changes between this version (struck out) and now (underlined).` : 'Identical to the current text.'))
    const body = h('div', { class: 'vs-text' })
    for (const p of parts) body.append(p.added ? h('ins', null, p.value) : p.removed ? h('del', null, p.value) : p.value)
    view.append(body)
    clear(actions)
    actions.append(
      h('button', { onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied.')) }, 'Copy Text'),
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            await api.saveVersion(path, app.text, true, 'Before restore')
            app.editor.replaceDoc(selected!.text)
            m.close()
            toast('Restored. Your previous text was saved as a version.')
          }
        },
        'Restore This Version'
      )
    )
  }

  if (!versions.length) list.append(h('div', { class: 'sb-empty' }, 'No versions yet. Versions are saved as you write.'))
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  for (const v of versions) {
    const el = h('button', { class: 'vs-item', onclick: () => show(v, el) }, h('span', null, fmt.format(v.time)), h('small', null, v.label || `${v.size.toLocaleString()} characters`))
    list.append(el)
  }
  const m = modal(`Versions of “${app.title}”`, h('div', { class: 'vs' }, list, h('div', { class: 'vs-main' }, view, actions)), { wide: true, className: 'tall' })
  if (versions[0]) show(versions[0], list.firstElementChild as HTMLElement)
}

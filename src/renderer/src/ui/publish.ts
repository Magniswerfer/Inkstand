// Publish the current document as a draft or post.
import type { App } from '../app'
import { extractTags, parseFrontMatter, splitFrontMatter } from '@shared/text'
import { h } from './dom'
import { modal, toast } from './overlay'

const api = window.api

export async function openPublish(app: App) {
  const accounts = app.settings.publishAccounts
  if (!accounts.length) {
    toast('Add a publishing account first.', { action: { label: 'Settings', run: () => app.run('preferences', 'publishing') } })
    return
  }
  const r = await app.render()
  const fm = parseFrontMatter(splitFrontMatter(app.text).frontMatter)
  // The first heading becomes the post title, so drop it from the body.
  const html = r.html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '')
  const markdown = r.markdown.replace(/^\s*#\s+.*\n/, '')
  const account = h('select', null, accounts.map((a) => h('option', { value: a.id }, a.name)))
  const title = h('input', { type: 'text', value: r.title || app.title })
  const tags = h('input', { type: 'text', value: (fm.tags ? fm.tags.replace(/[[\]]/g, '').split(',').map((t) => t.trim()) : extractTags(app.text)).join(', '), placeholder: 'comma, separated' })
  const status = h('select', null, h('option', { value: 'draft' }, 'Draft'), h('option', { value: 'publish' }, 'Publish now'))
  const button = h('button', { type: 'submit', class: 'primary' }, 'Publish')
  const form = h(
    'form',
    {
      class: 'fw-prompt',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        button.disabled = true
        button.textContent = 'Publishing…'
        try {
          const res = await api.publish({
            accountId: account.value,
            title: title.value,
            html,
            markdown,
            tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
            status: status.value as 'draft' | 'publish'
          })
          m.close()
          toast(status.value === 'draft' ? 'Draft created.' : 'Published.', { action: res.url ? { label: 'Open', run: () => api.openExternal(res.url) } : undefined, timeout: 8000 })
        } catch (err: any) {
          toast(`Publishing failed: ${err.message ?? err}`, { error: true })
          button.disabled = false
          button.textContent = 'Publish'
        }
      }
    },
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Account'), account),
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Title'), title),
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Tags'), tags),
    h('label', { class: 'pf-row' }, h('span', { class: 'pf-label' }, 'Status'), status),
    h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), button)
  )
  const m = modal('Publish', form)
}

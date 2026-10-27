// Get Info: what a file or folder is, where it lives, and how long it is.
import { parseAuthorship } from '@shared/authorship-file'
import { extractTags, isTextFile } from '@shared/text'
import type { App } from '../app'
import { computeStats, formatReadingTime } from '../stats'
import { basename, h } from './dom'
import { modal, toast } from './overlay'

const api = window.api

function size(n: number) {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export async function openGetInfo(app: App, path: string) {
  const st = await api.stat(path)
  if (!st) return toast('That item no longer exists.', { error: true })
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' })
  const rows: [string, string][] = [
    ['Kind', st.isDir ? 'Folder' : isTextFile(st.name) ? 'Text document' : (st.name.split('.').pop() ?? '').toUpperCase() + ' file'],
    ['Where', path.replace(/^\/Users\/[^/]+/, '~')],
    ['Created', fmt.format(st.ctime)],
    ['Modified', fmt.format(st.mtime)]
  ]
  if (st.isDir) {
    const files = await api.listAllFiles(path)
    rows.push(['Contains', `${files.length.toLocaleString()} files`])
  } else {
    rows.push(['Size', size(st.size)])
    if (isTextFile(st.name)) {
      const raw = path === app.path ? app.text : await api.readFile(path)
      const { body, entries } = await parseAuthorship(raw)
      const s = computeStats(body, app.settings.wordsPerMinute, app.settings.wordsPerPage)
      rows.push(
        ['Words', s.words.toLocaleString()],
        ['Characters', `${s.characters.toLocaleString()} (${s.charactersNoSpaces.toLocaleString()} without spaces)`],
        ['Reading time', formatReadingTime(s.readingMinutes)],
        ['Speaking time', formatReadingTime(s.words / 150)]
      )
      const tags = extractTags(body)
      if (tags.length) rows.push(['Hashtags', tags.map((t) => '#' + t).join(' ')])
      if (entries.length) rows.push(['Authors', entries.map((e) => e.name).join(', ')])
    }
  }
  const body = h(
    'div',
    { class: 'fw-prompt' },
    h('table', { class: 'fw-info' }, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v)))),
    h(
      'div',
      { class: 'fw-actions' },
      h('button', { onclick: () => navigator.clipboard.writeText(path).then(() => toast('Copied path.')) }, 'Copy Path'),
      h('button', { onclick: () => api.reveal(path) }, 'Reveal in Finder'),
      !st.isDir && isTextFile(st.name) ? h('button', { class: 'primary', onclick: () => (m.close(), app.open(path)) }, 'Open') : null
    )
  )
  const m = modal(basename(path), body)
}

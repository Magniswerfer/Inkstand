// Modals, prompts, context menus and toasts.
import { h } from './dom'

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void; className?: string } = {}) {
  const close = () => {
    backdrop.remove()
    document.removeEventListener('keydown', onKey, true)
    opts.onClose?.()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }
  const backdrop = h(
    'div',
    { class: 'fw-backdrop', onmousedown: (e: MouseEvent) => e.target === backdrop && close() },
    h(
      'div',
      { class: `fw-modal ${opts.wide ? 'wide' : ''} ${opts.className ?? ''}`, role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'fw-icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      body
    )
  )
  document.addEventListener('keydown', onKey, true)
  document.body.append(backdrop)
  return { close, root: backdrop }
}

export function prompt(title: string, value = '', opts: { label?: string; okLabel?: string; select?: [number, number] } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value, class: 'fw-input', spellcheck: 'false' })
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      m.close()
      resolve(v)
    }
    const form = h(
      'form',
      { class: 'fw-prompt', onsubmit: (e: Event) => (e.preventDefault(), finish(input.value)) },
      opts.label ? h('label', null, opts.label) : null,
      input,
      h('div', { class: 'fw-actions' }, h('button', { type: 'button', onclick: () => finish(null) }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, opts.okLabel ?? 'OK'))
    )
    const m = modal(title, form, { onClose: () => finish(null) })
    input.focus()
    if (opts.select) input.setSelectionRange(...opts.select)
    else input.select()
  })
}

let menuEl: HTMLElement | null = null

export interface MenuItem {
  label: string
  action?: () => void
  disabled?: boolean
  checked?: boolean
  separator?: boolean
}

export function contextMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault()
  e.stopPropagation()
  menuEl?.remove()
  const close = () => {
    menuEl?.remove()
    menuEl = null
    window.removeEventListener('mousedown', outside, true)
    window.removeEventListener('blur', close)
  }
  const outside = (ev: MouseEvent) => {
    if (!menuEl?.contains(ev.target as Node)) close()
  }
  menuEl = h(
    'div',
    { class: 'fw-menu', role: 'menu' },
    items.map((it) =>
      it.separator
        ? h('hr')
        : h(
            'button',
            {
              role: 'menuitem',
              disabled: it.disabled,
              onclick: () => {
                close()
                it.action?.()
              }
            },
            h('span', { class: 'check' }, it.checked ? '✓' : ''),
            it.label
          )
    )
  )
  document.body.append(menuEl)
  const r = menuEl.getBoundingClientRect()
  menuEl.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px'
  menuEl.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px'
  setTimeout(() => {
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('blur', close)
  })
}

export function toast(message: string, opts: { error?: boolean; action?: { label: string; run: () => void }; timeout?: number } = {}) {
  let host = document.querySelector('.fw-toasts')
  if (!host) document.body.append((host = h('div', { class: 'fw-toasts', 'aria-live': 'polite' })))
  const el = h(
    'div',
    { class: `fw-toast ${opts.error ? 'error' : ''}` },
    h('span', null, message),
    opts.action ? h('button', { onclick: () => (opts.action!.run(), el.remove()) }, opts.action.label) : null
  )
  host.append(el)
  setTimeout(() => el.remove(), opts.timeout ?? (opts.error ? 7000 : 3500))
}

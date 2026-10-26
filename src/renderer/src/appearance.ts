import type { Settings } from '@shared/types'

// Installed iA Writer fonts (free, OFL) are picked up if present; IBM Plex ships with the app.
export const FONT_STACKS: Record<Exclude<Settings['font'], 'custom'>, string> = {
  mono: "'iA Writer Mono S', 'iA Writer Mono V', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
  duo: "'iA Writer Duo S', 'iA Writer Duo V', 'iA Writer Duospace', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
  sans: "'iA Writer Quattro S', 'iA Writer Quattro V', 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif",
  serif: "'IBM Plex Serif', Charter, 'Iowan Old Style', Georgia, serif"
}

const WIDTHS = { narrow: '54ch', medium: '68ch', wide: '86ch', full: 'none' }
const media = matchMedia('(prefers-color-scheme: dark)')
let current: Settings | null = null
media.addEventListener('change', () => current && applyAppearance(current))

export function resolvedTheme(s: Settings): 'light' | 'dark' {
  return s.theme === 'system' ? (media.matches ? 'dark' : 'light') : s.theme
}

export function applyAppearance(s: Settings) {
  current = s
  const root = document.documentElement
  root.dataset.theme = resolvedTheme(s)
  const family = s.font === 'custom' ? `${s.customFont || 'serif'}, ${FONT_STACKS.serif}` : FONT_STACKS[s.font]
  root.style.setProperty('--fw-font', family)
  root.style.setProperty('--fw-size', s.fontSize + 'px')
  root.style.setProperty('--fw-line-height', String(s.lineHeight))
  root.style.setProperty('--fw-width', WIDTHS[s.lineWidth])
  root.dataset.font = s.font
  document.fonts.ready.then(() => measureMarks(family, s.fontSize))
}

/** Heading marks hang in the margin; their width depends on the font, so measure it. */
function measureMarks(family: string, size: number) {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `600 ${size}px ${family}`
  const root = document.documentElement
  root.style.setProperty('--fw-hash-w', ctx.measureText('#').width + 'px')
  root.style.setProperty('--fw-space-w', ctx.measureText(' ').width + 'px')
}

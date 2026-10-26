import type { Settings } from '@shared/types'
import { setMeasureFont } from './editor/measure'

// iA Writer Mono, Duo and Quattro ship with the app (SIL OFL); IBM Plex Serif covers the serif option.
export const FONT_STACKS: Record<Exclude<Settings['font'], 'custom'>, string> = {
  mono: "'iA Writer Mono S', ui-monospace, Menlo, monospace",
  duo: "'iA Writer Duo S', ui-monospace, Menlo, monospace",
  sans: "'iA Writer Quattro S', -apple-system, 'Segoe UI', sans-serif",
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
  root.dataset.platform = window.api.platform
  const family = s.font === 'custom' ? `${s.customFont || 'serif'}, ${FONT_STACKS.serif}` : FONT_STACKS[s.font]
  root.style.setProperty('--fw-font', family)
  root.style.setProperty('--fw-size', s.fontSize + 'px')
  root.style.setProperty('--fw-line-height', String(s.lineHeight))
  root.style.setProperty('--fw-width', WIDTHS[s.lineWidth])
  root.dataset.font = s.font
  const font = `${s.fontSize}px ${family}`
  if (font !== measuredFont) {
    measuredFont = font
    // Measure only once the face has loaded, or hanging indents use the fallback font's widths.
    Promise.all([document.fonts.load(font), document.fonts.load('italic ' + font), document.fonts.load('bold ' + font)]).then(() => {
      if (measuredFont !== font) return
      setMeasureFont(font)
      for (const cb of metricListeners) cb()
    })
  }
}

let measuredFont = ''
const metricListeners: (() => void)[] = []

/** Called when the editor font's metrics change and text measurements must be redone. */
export function onMetrics(cb: () => void) {
  metricListeners.push(cb)
}

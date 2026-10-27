// Measures text in the editor font, so markup can hang in the margin and wrapped list lines align.
let ctx: CanvasRenderingContext2D | null = null
let base = '16px monospace'
const cache = new Map<string, number>()

export function setMeasureFont(font: string) {
  base = font
  cache.clear()
}

export function textWidth(s: string, bold = false): number {
  const key = (bold ? 'b' : 'r') + s
  let w = cache.get(key)
  if (w === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d')!
    ctx.font = bold ? `bold ${base}` : base
    // Tabs render as four spaces (tabSize 4).
    w = ctx.measureText(s.replace(/\t/g, '    ')).width
    cache.set(key, w)
  }
  return w
}

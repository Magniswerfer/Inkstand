// Measures text in the editor font, so markup can hang in the margin and wrapped list lines align.
let ctx: CanvasRenderingContext2D | null = null
const context = () => (ctx ??= document.createElement('canvas').getContext('2d')!)
const cache = new Map<string, number>()

export function setMeasureFont(font: string) {
  context().font = font
  cache.clear()
}

export function textWidth(s: string): number {
  let w = cache.get(s)
  if (w === undefined) {
    // Tabs render as four spaces (tabSize 4).
    w = context().measureText(s.replace(/\t/g, '    ')).width
    cache.set(s, w)
  }
  return w
}

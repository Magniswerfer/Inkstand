import { splitFrontMatter } from '@shared/text'

export interface Stats {
  words: number
  characters: number
  charactersNoSpaces: number
  sentences: number
  paragraphs: number
  readingMinutes: number
  speakingMinutes: number
  pages: number
}

const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' })
const sentenceSeg = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/** Removes Markdown syntax so counts reflect what a reader sees. */
export function plainText(md: string): string {
  const { body } = splitFrontMatter(md)
  return body
    .replace(/^(```|~~~)[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~|==|[*_`])/g, '')
}

export function countWords(text: string): number {
  let n = 0
  for (const s of wordSeg.segment(text)) if (s.isWordLike) n++
  return n
}

export function computeStats(md: string, wordsPerMinute = 230, wordsPerPage = 275, speakingWordsPerMinute = 150): Stats {
  const text = plainText(md)
  const words = countWords(text)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length
  let sentences = 0
  for (const para of text.split(/\n\s*\n/)) {
    for (const s of sentenceSeg.segment(para)) if (/[\p{L}\p{N}]/u.test(s.segment)) sentences++
  }
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim()
  return {
    words,
    characters: [...trimmed].length,
    charactersNoSpaces: [...trimmed.replace(/\s/g, '')].length,
    sentences,
    paragraphs,
    readingMinutes: words / wordsPerMinute,
    speakingMinutes: words / speakingWordsPerMinute,
    pages: words / wordsPerPage
  }
}

export function formatReadingTime(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`
  if (minutes < 60) return `${Math.round(minutes)} min`
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`
}

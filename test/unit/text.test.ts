import { describe, expect, it } from 'vitest'
import { extractTags, extractTitle, fileNameFromTitle, splitFrontMatter } from '@shared/text'
import { computeStats } from '../../src/renderer/src/stats'
import { formatTable } from '../../src/renderer/src/markdown/table'
import { buildMatchers, findIssues } from '../../src/renderer/src/editor/style'
import { smartQuote } from '../../src/renderer/src/editor/typography'
import { subtract } from '../../src/renderer/src/editor/authorship'
import { parseCsv, resolvePath } from '../../src/renderer/src/markdown/render'
import { DEFAULT_SETTINGS } from '@shared/types'

describe('text helpers', () => {
  it('finds hashtags but not headings, code or anchors', () => {
    expect(extractTags('# Title\n\nSee #ideas and #work/draft.\n`#notatag`\n```\n#nope\n```\nurl#frag')).toEqual(['ideas', 'work/draft'])
  })
  it('reads titles from front matter, headings and first lines', () => {
    expect(extractTitle('---\ntitle: Hello\n---\n# Other')).toBe('Hello')
    expect(extractTitle('\n\n## **Bold** title\n')).toBe('Bold title')
    expect(extractTitle('Plain first line\nmore')).toBe('Plain first line')
  })
  it('splits front matter', () => {
    const r = splitFrontMatter('---\na: 1\n---\nbody')
    expect(r.frontMatter).toBe('a: 1')
    expect(r.body).toBe('body')
  })
  it('makes safe file names', () => {
    expect(fileNameFromTitle('A/B: c?')).toBe('AB c')
    expect(fileNameFromTitle('   ')).toBe('Untitled')
  })
})

describe('stats', () => {
  it('counts words and sentences without markup', () => {
    const s = computeStats('# Head\n\nOne **two** three. Four [five](http://x.y)!\n\n- six')
    expect(s.words).toBe(7)
    expect(s.sentences).toBe(4)
    expect(s.paragraphs).toBe(3)
  })
})

describe('tables', () => {
  it('aligns pipe tables and keeps alignment markers', () => {
    expect(formatTable(['|a|bbb|', '|:-|-:|', '|cc|d|'])).toEqual(['| a   | bbb |', '| :-- | --: |', '| cc  |   d |'])
  })
})

describe('style check', () => {
  const cfg = { ...DEFAULT_SETTINGS.styleCheck, fillers: true, cliches: true, redundancies: true }
  it('finds fillers, clichés and redundancies with suggestions', () => {
    const issues = findIssues('It is very much a free gift, at the end of the day.', buildMatchers(cfg), new Set())
    expect(issues.map((i) => [i.kind, i.text])).toEqual([
      ['filler', 'very'],
      ['redundancy', 'free gift'],
      ['cliche', 'at the end of the day']
    ])
    expect(issues[1].suggestion).toBe('gift')
  })
  it('respects ignored phrases and word boundaries', () => {
    expect(findIssues('justice is very good', buildMatchers(cfg), new Set(['very']))).toEqual([])
  })
  it('supports custom regex patterns', () => {
    const m = buildMatchers({ ...DEFAULT_SETTINGS.styleCheck, custom: [{ id: '1', pattern: 'TODO\\b', isRegex: true, caseSensitive: true, note: 'Finish', enabled: true }] })
    expect(findIssues('a TODO b todo', m, new Set()).map((i) => i.text)).toEqual(['TODO'])
  })
})

describe('typography', () => {
  it('opens and closes quotes by context', () => {
    expect(smartQuote(' ', '"')).toBe('“')
    expect(smartQuote('o', '"')).toBe('”')
    expect(smartQuote('t', "'")).toBe('’')
    expect(smartQuote('', "'")).toBe('‘')
  })
})

describe('authorship', () => {
  it('subtracts typed ranges from authored ones', () => {
    expect(subtract([[0, 10, 'ai']], 3, 5)).toEqual([[0, 3, 'ai'], [5, 10, 'ai']])
  })
})

describe('content blocks', () => {
  it('resolves paths relative to the document', () => {
    expect(resolvePath('/a/b/doc.md', '/img/x.png')).toBe('/a/b/img/x.png')
    expect(resolvePath('/a/b/doc.md', './../c.md')).toBe('/a/c.md')
    expect(resolvePath('/a/b/doc.md', '/My%20File.md')).toBe('/a/b/My File.md')
  })
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\n"1,5","say ""hi"""\n', ',')).toEqual([['a', 'b'], ['1,5', 'say "hi"']])
  })
})

import { describe, expect, it } from 'vitest'
import { matchQuery, parseQuery } from '@shared/query'

const doc = {
  name: 'Note on time.md',
  text: 'First line about time travel and outer space.\n- [ ] buy milk\n- [x] done\n#diary #priority-high\n'
}
const m = (q: string, d = doc) => matchQuery(parseQuery(q), d)

describe('library query language', () => {
  it('matches word prefixes in name and text', () => {
    expect(m('tim trav')).toBe(true)
    expect(m('time zebra')).toBe(false)
  })
  it('matches phrases exactly unless starred', () => {
    expect(m('"time travel"')).toBe(true)
    expect(m('"time trav"')).toBe(false)
    expect(m('"time trav*"')).toBe(true)
  })
  it('handles hashtags', () => {
    expect(m('#prior')).toBe(true)
    expect(m('"#diary"')).toBe(true)
    expect(m('"#dia"')).toBe(false)
    expect(m('-#')).toBe(false)
    expect(m('-#', { name: 'x.md', text: 'no tags' })).toBe(true)
  })
  it('handles tasks, extensions, names and first words', () => {
    expect(m('[ ]')).toBe(true)
    expect(m('[x]')).toBe(true)
    expect(m('[ ]', { name: 'x.md', text: '- [x] only done' })).toBe(false)
    expect(m('.m')).toBe(true)
    expect(m('".m"')).toBe(false)
    expect(m('".md"')).toBe(true)
    expect(m('name:note')).toBe(true)
    expect(m('name:travel')).toBe(false)
    expect(m('name:^"note"')).toBe(true)
    expect(m('^first')).toBe(true)
    expect(m('^line')).toBe(false)
  })
  it('combines with AND, OR, NOT, minus and parentheses', () => {
    expect(m('time AND space')).toBe(true)
    expect(m('zebra OR "space"')).toBe(true)
    expect(m('time NOT space')).toBe(false)
    expect(m('-microsoft word')).toBe(false)
    expect(m('-microsoft time')).toBe(true)
    expect(m('(zebra AND time) OR milk')).toBe(true)
    expect(m('(zebra AND time) OR cow')).toBe(false)
  })
  it('supports NEAR with a distance', () => {
    expect(m('NEAR(time space)')).toBe(true)
    expect(m('NEAR(first space 2)')).toBe(false)
    expect(m('NEAR(first space 8)')).toBe(true)
  })
})

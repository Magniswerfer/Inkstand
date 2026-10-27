import { describe, expect, it } from 'vitest'
import { columnAt, editTable, parseTable, renderTable } from '../../src/renderer/src/markdown/table'
import { changeCase } from '../../src/renderer/src/editor/transform'
import { createMarkdown } from '../../src/renderer/src/markdown/render'

const table = ['| Name | Age |', '| --- | --: |', '| Bo | 30 |', '| Al | 4 |']

describe('table editing', () => {
  it('parses rows and alignment', () => {
    const t = parseTable(table)
    expect(t.rows).toEqual([['Name', 'Age'], ['Bo', '30'], ['Al', '4']])
    expect(t.align).toEqual(['', 'r'])
  })
  it('finds the column under the caret', () => {
    expect(columnAt('| Bo | 30 |', 3)).toBe(0)
    expect(columnAt('| Bo | 30 |', 7)).toBe(1)
  })
  it('adds and deletes rows and columns', () => {
    const t = parseTable(table)
    expect(editTable(t, 'rowBelow', 1, 0).table.rows[2]).toEqual(['', ''])
    expect(editTable(t, 'deleteRow', 1, 0).table.rows).toEqual([['Name', 'Age'], ['Al', '4']])
    expect(editTable(t, 'deleteRow', 0, 0).table).toBe(t)
    const c = editTable(t, 'colBefore', 0, 1)
    expect(c.table.rows[0]).toEqual(['Name', '', 'Age'])
    expect(c.col).toBe(1)
    expect(editTable(t, 'deleteCol', 0, 0).table.rows[0]).toEqual(['Age'])
  })
  it('moves rows and columns, keeping the header in place', () => {
    const t = parseTable(table)
    expect(editTable(t, 'rowDown', 1, 0).table.rows.map((r) => r[0])).toEqual(['Name', 'Al', 'Bo'])
    expect(editTable(t, 'rowUp', 1, 0).table).toBe(t)
    const m = editTable(t, 'colRight', 0, 0).table
    expect(m.rows[0]).toEqual(['Age', 'Name'])
    expect(m.align).toEqual(['r', ''])
  })
  it('sorts numerically when a column is numeric', () => {
    expect(editTable(parseTable(table), 'sortAsc', 1, 1).table.rows.map((r) => r[1])).toEqual(['Age', '4', '30'])
    expect(editTable(parseTable(table), 'sortDesc', 1, 0).table.rows.map((r) => r[0])).toEqual(['Name', 'Bo', 'Al'])
  })
  it('aligns and transposes', () => {
    expect(renderTable(editTable(parseTable(table), 'alignCenter', 0, 0).table)[1]).toMatch(/^\| :-+: \|/)
    expect(editTable(parseTable(table), 'transpose', 0, 0).table.rows).toEqual([['Name', 'Bo', 'Al'], ['Age', '30', '4']])
  })
})

describe('case transformations', () => {
  it('title-cases with small words and deliberate casing', () => {
    expect(changeCase('the lord of the rings on an iPhone', 'title')).toBe('The Lord of the Rings on an iPhone')
    expect(changeCase('a tale of two cities', 'title')).toBe('A Tale of Two Cities')
  })
  it('upper, lower and capitalize', () => {
    expect(changeCase('Hello World', 'upper')).toBe('HELLO WORLD')
    expect(changeCase('Hello World', 'lower')).toBe('hello world')
    expect(changeCase('hello wide world', 'capitalize')).toBe('Hello Wide World')
  })
})

describe('callouts', () => {
  const md = createMarkdown()
  it('renders GitHub alert syntax with a title', () => {
    const html = md.render('> [!WARNING]\n> Mind the gap.\n')
    expect(html).toContain('class="fw-alert fw-alert-warning"')
    expect(html).toContain('<p class="fw-alert-title">Warning</p>')
    expect(html).toContain('Mind the gap.')
    expect(html).not.toContain('[!WARNING]')
  })
  it('leaves ordinary quotes alone', () => {
    expect(md.render('> [!unknown] text\n')).not.toContain('fw-alert')
  })
})

import { guessLanguage } from '../../src/renderer/src/editor/speech'

describe('speech language', () => {
  it('uses front matter, then letters only some languages use', () => {
    expect(guessLanguage('---\nlang: fr-FR\n---\nBonjour')).toBe('fr-FR')
    expect(guessLanguage('Det er en god dag på øen.')).toBe('da')
    expect(guessLanguage('Das ist nicht gut und schön.')).toBe('de')
  })
})

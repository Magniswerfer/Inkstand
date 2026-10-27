import { describe, expect, it } from 'vitest'
import { parseAuthorship, writeAuthorship } from '@shared/authorship-file'
import { splitAuthorship } from '@shared/text'

describe('authorship in the file', () => {
  it('round-trips authors and ranges', async () => {
    const body = 'I wrote this. The machine wrote this.\n'
    const file = await writeAuthorship(body, [{ name: 'ChatGPT', kind: 'ai', ranges: [[14, 37]] }])
    expect(file.startsWith(body)).toBe(true)
    expect(file).toContain('@ChatGPT [ai]: 14-37')
    const parsed = await parseAuthorship(file)
    expect(parsed.body).toBe(body)
    expect(parsed.stale).toBe(false)
    expect(parsed.entries).toEqual([{ name: 'ChatGPT', kind: 'ai', ranges: [[14, 37]] }])
  })
  it('writes nothing extra when everything is yours', async () => {
    expect(await writeAuthorship('Mine.\n', [])).toBe('Mine.\n')
  })
  it('detects edits made elsewhere', async () => {
    const file = await writeAuthorship('Hello there.\n', [{ name: 'Quote', kind: 'reference', ranges: [[0, 5]] }])
    const parsed = await parseAuthorship(file.replace('Hello', 'Howdy'))
    expect(parsed.stale).toBe(true)
    expect(parsed.entries).toEqual([])
    expect(parsed.body).toBe('Howdy there.\n')
  })
  it('leaves documents without a block untouched', async () => {
    expect(await parseAuthorship('Plain\n')).toEqual({ body: 'Plain\n', entries: [], stale: false })
    expect(splitAuthorship('Plain').block).toBeNull()
  })
})

import { planEdits } from '../../src/renderer/src/editor/edits'

describe('paste edits', () => {
  it('applies only the changed words and reports what was inserted', () => {
    const before = 'The cat sat on the mat.'
    const after = 'The black cat sat on the rug.'
    const { changes, inserted } = planEdits(before, after)
    let out = before
    for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
    expect(out).toBe(after)
    expect(inserted.map(([a, b]) => after.slice(a, b).trim())).toEqual(['black', 'rug'])
  })
})

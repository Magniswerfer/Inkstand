import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Authorship, VersionInfo } from '@shared/types'
import { dataPath } from './paths'
import { getSettings } from './settings'

const key = (path: string) => createHash('sha1').update(path).digest('hex')
const dirFor = (path: string) => dataPath('versions', key(path))

interface Index {
  path: string
  versions: VersionInfo[]
}

async function readIndex(path: string): Promise<Index> {
  try {
    return JSON.parse(await fs.readFile(join(dirFor(path), 'index.json'), 'utf8'))
  } catch {
    return { path, versions: [] }
  }
}

async function writeIndex(path: string, index: Index) {
  await fs.mkdir(dirFor(path), { recursive: true })
  await fs.writeFile(join(dirFor(path), 'index.json'), JSON.stringify(index))
}

export async function listVersions(path: string): Promise<VersionInfo[]> {
  return (await readIndex(path)).versions.slice().reverse()
}

export async function readVersion(path: string, id: string): Promise<string> {
  return fs.readFile(join(dirFor(path), id.replace(/[^\w.-]/g, '') + '.md'), 'utf8')
}

/**
 * Stores a snapshot. Automatic snapshots (force=false) are skipped when the last one is recent
 * or identical; manual ones are always kept and never pruned.
 */
export async function saveVersion(path: string, content: string, force: boolean, label = ''): Promise<VersionInfo | null> {
  const { versions: cfg } = getSettings()
  if (!force && !cfg.enabled) return null
  const index = await readIndex(path)
  const last = index.versions[index.versions.length - 1]
  if (last) {
    const lastContent = await readVersion(path, last.id).catch(() => null)
    if (lastContent === content) return null
    if (!force && Date.now() - last.time < cfg.intervalMinutes * 60_000) return null
  }
  const time = Date.now()
  const info: VersionInfo = { id: String(time), time, size: content.length, label }
  await fs.mkdir(dirFor(path), { recursive: true })
  await fs.writeFile(join(dirFor(path), info.id + '.md'), content)
  index.versions.push(info)
  while (index.versions.filter((v) => !v.label).length > cfg.max) {
    const i = index.versions.findIndex((v) => !v.label)
    const [old] = index.versions.splice(i, 1)
    await fs.rm(join(dirFor(path), old.id + '.md'), { force: true })
  }
  await writeIndex(path, index)
  return info
}

/** Keeps history and authorship attached to a document when it is renamed or moved. */
export async function moveVersions(from: string, to: string) {
  const src = dirFor(from)
  const dest = dirFor(to)
  try {
    await fs.rm(dest, { recursive: true, force: true })
    await fs.rename(src, dest)
    const index = await readIndex(to)
    index.path = to
    await writeIndex(to, index)
  } catch {
    // No history yet.
  }
  await fs.rename(authorshipFile(from), authorshipFile(to)).catch(() => {})
}

const authorshipFile = (path: string) => dataPath('authorship', key(path) + '.json')

export async function getAuthorship(path: string): Promise<Authorship | null> {
  try {
    return JSON.parse(await fs.readFile(authorshipFile(path), 'utf8'))
  } catch {
    return null
  }
}

export async function setAuthorship(path: string, a: Authorship) {
  await fs.mkdir(dataPath('authorship'), { recursive: true })
  await fs.writeFile(authorshipFile(path), JSON.stringify(a))
}

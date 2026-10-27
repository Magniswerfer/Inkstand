import { app, BrowserWindow, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type PublishAccount, type Settings } from '@shared/types'

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
type Listener = (next: Settings, prev: Settings) => void
const listeners: Listener[] = []

export function onSettingsChanged(fn: Listener) {
  listeners.push(fn)
}

function merge(base: Settings, patch: Partial<Settings>): Settings {
  const out = { ...base, ...patch } as Settings
  // Nested objects are merged one level deep so older settings files pick up new keys.
  for (const key of ['syntax', 'styleCheck', 'authorship', 'versions', 'markdown', 'indent', 'links', 'page'] as const) {
    if (patch[key]) (out as any)[key] = { ...(base as any)[key], ...(patch as any)[key] }
  }
  return out
}

/** Moves settings still at an old default onto the new default; values the user chose are kept. */
function migrate(s: Settings, fromVersion: number): Settings {
  if (fromVersion < 2) {
    // v2 matches iA Writer: larger type, markup in the text colour.
    if (s.fontSize === 17 || s.fontSize === 18) s.fontSize = DEFAULT_SETTINGS.fontSize
    if (s.lineHeight === 1.6) s.lineHeight = DEFAULT_SETTINGS.lineHeight
    if (s.markup === 'dim') s.markup = DEFAULT_SETTINGS.markup
  }
  s.settingsVersion = DEFAULT_SETTINGS.settingsVersion
  return s
}

export function getSettings(): Settings {
  if (current) return current
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))
    current = migrate(merge(DEFAULT_SETTINGS, raw), raw.settingsVersion ?? 1)
  } catch {
    current = structuredClone(DEFAULT_SETTINGS)
  }
  return current
}

export function setSettings(patch: Partial<Settings>): Settings {
  const prev = getSettings()
  current = merge(prev, patch)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(current, null, 2))
  const safe = publicSettings()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings', safe)
  for (const fn of listeners) fn(current, prev)
  return safe
}

/** Settings as the renderer sees them: account secrets are blanked out. */
export function publicSettings(): Settings {
  const s = getSettings()
  return { ...s, publishAccounts: s.publishAccounts.map((a) => ({ ...a, secret: a.secret ? '••••' : '' })) }
}

export function encryptSecret(secret: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(secret).toString('base64')
  return 'plain:' + Buffer.from(secret).toString('base64')
}

export function decryptSecret(account: PublishAccount): string {
  const [kind, data] = [account.secret.slice(0, account.secret.indexOf(':')), account.secret.slice(account.secret.indexOf(':') + 1)]
  if (kind === 'enc') return safeStorage.decryptString(Buffer.from(data, 'base64'))
  return Buffer.from(data, 'base64').toString('utf8')
}

export function addRecent(path: string) {
  const s = getSettings()
  const recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, 30)
  setSettings({ recent })
  app.addRecentDocument(path)
}

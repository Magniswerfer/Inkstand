// Types shared by the main process, the preload bridge and the renderer.

export type Theme = 'system' | 'light' | 'dark'
export type FontChoice = 'mono' | 'duo' | 'sans' | 'serif' | 'custom'
export type FocusMode = 'off' | 'sentence' | 'paragraph' | 'line'
export type MarkupMode = 'dim' | 'hide' | 'show'
export type LineWidth = 'narrow' | 'medium' | 'wide' | 'full'
export type StatMetric = 'words' | 'characters' | 'sentences' | 'paragraphs' | 'readingTime' | 'pages'
export type SortOrder = 'modified' | 'name' | 'created'

export interface CustomPattern {
  id: string
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  note: string
  enabled: boolean
}

export interface SmartFolder {
  id: string
  name: string
  query: string
}

export interface PublishAccount {
  id: string
  kind: 'wordpress' | 'ghost' | 'medium' | 'microblog'
  name: string
  url: string
  username: string
  /** Encrypted with Electron safeStorage when available; never sent back to the renderer in clear. */
  secret: string
}

export interface Settings {
  theme: Theme
  font: FontChoice
  customFont: string
  fontSize: number
  lineHeight: number
  lineWidth: LineWidth
  markup: MarkupMode
  hangingHeadings: boolean
  focusMode: FocusMode
  typewriter: boolean
  syntax: { adjectives: boolean; nouns: boolean; adverbs: boolean; verbs: boolean; conjunctions: boolean }
  styleCheck: {
    fillers: boolean
    cliches: boolean
    redundancies: boolean
    custom: CustomPattern[]
    ignored: string[]
  }
  smartQuotes: boolean
  smartDashes: boolean
  autoPair: boolean
  spellcheck: boolean
  inlineImages: boolean
  pasteRichText: boolean
  dropInsert: 'block' | 'markdown'
  assetsFolder: string
  showStats: boolean
  statMetric: StatMetric
  wordsPerMinute: number
  wordsPerPage: number
  showSidebar: boolean
  showOutline: boolean
  showPreview: boolean
  previewSync: boolean
  previewTemplate: string
  exportTemplate: string
  pdfPaper: 'A4' | 'Letter' | 'Legal' | 'A5'
  libraryLocations: string[]
  librarySort: SortOrder
  showExtensions: boolean
  favorites: string[]
  recent: string[]
  smartFolders: SmartFolder[]
  authorship: { enabled: boolean; showBorrowed: boolean; author: string }
  versions: { enabled: boolean; intervalMinutes: number; max: number }
  autosave: boolean
  defaultExtension: 'md' | 'markdown' | 'txt'
  publishAccounts: PublishAccount[]
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  font: 'duo',
  customFont: '',
  fontSize: 18,
  lineHeight: 1.6,
  lineWidth: 'medium',
  markup: 'dim',
  hangingHeadings: true,
  focusMode: 'off',
  typewriter: false,
  syntax: { adjectives: false, nouns: false, adverbs: false, verbs: false, conjunctions: false },
  styleCheck: { fillers: false, cliches: false, redundancies: false, custom: [], ignored: [] },
  smartQuotes: true,
  smartDashes: true,
  autoPair: true,
  spellcheck: true,
  inlineImages: true,
  pasteRichText: true,
  dropInsert: 'block',
  assetsFolder: 'assets',
  showStats: true,
  statMetric: 'words',
  wordsPerMinute: 230,
  wordsPerPage: 275,
  showSidebar: true,
  showOutline: false,
  showPreview: false,
  previewSync: true,
  previewTemplate: 'classic',
  exportTemplate: 'classic',
  pdfPaper: 'A4',
  libraryLocations: [],
  librarySort: 'modified',
  showExtensions: false,
  favorites: [],
  recent: [],
  smartFolders: [],
  authorship: { enabled: true, showBorrowed: false, author: '' },
  versions: { enabled: true, intervalMinutes: 10, max: 200 },
  autosave: true,
  defaultExtension: 'md',
  publishAccounts: []
}

export interface DirEntry {
  path: string
  name: string
  isDir: boolean
  mtime: number
  ctime: number
  size: number
}

export interface FileSummary extends DirEntry {
  title: string
  excerpt: string
  tags: string[]
}

export interface SearchHit {
  path: string
  name: string
  title: string
  mtime: number
  line: number
  snippet: string
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  author: string
  builtIn: boolean
  /** Base URL (fw-template://…/) that the template's relative resources resolve against. */
  baseUrl: string
  documentHtml: string
  headerHtml: string
  footerHtml: string
  titleHtml: string
  headerHeight: number
  footerHeight: number
}

export interface VersionInfo {
  id: string
  time: number
  size: number
  label: string
}

export interface Authorship {
  /** Ranges of text that the user did not type themselves (pasted / AI / other authors). */
  borrowed: [number, number][]
}

export interface PdfOptions {
  html: string
  baseUrl: string
  title: string
  headerHtml: string
  footerHtml: string
  headerHeight: number
  footerHeight: number
  paper: Settings['pdfPaper']
}

export interface PublishRequest {
  accountId: string
  title: string
  html: string
  markdown: string
  tags: string[]
  status: 'draft' | 'publish'
}

export interface FileChangeEvent {
  path: string
  kind: 'change' | 'rename'
}

/** Menu command ids sent from the main process to the focused window. */
export type MenuCommand = string

export interface FossWriteApi {
  platform: NodeJS.Platform
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettings(cb: (s: Settings) => void): () => void
  onMenu(cb: (cmd: MenuCommand, arg?: unknown) => void): () => void
  onOpenFile(cb: (path: string) => void): () => void
  onFileChanged(cb: (e: FileChangeEvent) => void): () => void
  onLibraryChanged(cb: (dir: string) => void): () => void

  readFile(path: string): Promise<string>
  readFileBase64(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<{ mtime: number }>
  writeBinary(path: string, data: ArrayBuffer): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<DirEntry | null>
  listDir(dir: string): Promise<FileSummary[]>
  listAllFiles(root: string): Promise<DirEntry[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  search(roots: string[], query: string): Promise<SearchHit[]>
  tags(roots: string[]): Promise<{ tag: string; count: number }[]>
  watchFile(path: string | null): Promise<void>
  watchLibrary(dirs: string[]): Promise<void>

  showOpenDialog(opts: { directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>
  showSaveDialog(opts: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
  confirm(opts: { message: string; detail?: string; buttons: string[] }): Promise<number>

  setDocumentState(state: { path: string | null; dirty: boolean; title: string }): void
  newWindow(path?: string): Promise<void>

  listTemplates(): Promise<TemplateInfo[]>
  importTemplate(): Promise<TemplateInfo | null>
  removeTemplate(id: string): Promise<void>
  revealTemplates(): Promise<void>

  exportPdf(opts: PdfOptions, target: string): Promise<void>
  print(opts: PdfOptions): Promise<void>
  copyRich(html: string, text: string): Promise<void>

  listVersions(path: string): Promise<VersionInfo[]>
  readVersion(path: string, id: string): Promise<string>
  saveVersion(path: string, content: string, force: boolean, label?: string): Promise<VersionInfo | null>
  moveVersions(from: string, to: string): Promise<void>

  getAuthorship(path: string): Promise<Authorship | null>
  setAuthorship(path: string, a: Authorship): Promise<void>

  saveAccount(account: Omit<PublishAccount, 'secret'> & { secret?: string }): Promise<Settings>
  publish(req: PublishRequest): Promise<{ url: string }>

  addDictionaryWord(word: string): Promise<void>
  getPathForFile(file: File): string
}

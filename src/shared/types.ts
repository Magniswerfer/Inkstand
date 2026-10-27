// Types shared by the main process, the preload bridge and the renderer.

export type Theme = 'system' | 'light' | 'dark'
export type FontChoice = 'mono' | 'duo' | 'sans' | 'serif' | 'custom'
export type FocusMode = 'off' | 'sentence' | 'paragraph' | 'line'
export type MarkupMode = 'dim' | 'hide' | 'show'
export type LineWidth = 'narrow' | 'medium' | 'wide' | 'full'
export type StatMetric = 'words' | 'characters' | 'sentences' | 'paragraphs' | 'readingTime' | 'speakingTime' | 'pages'
export type SortOrder = 'modified' | 'name' | 'created' | 'size' | 'kind'

export interface CustomPattern {
  id: string
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  note: string
  enabled: boolean
}

export type AuthorKind = 'human' | 'ai' | 'reference'

/** Someone or something other than you that text can be attributed to. */
export interface Author {
  id: string
  name: string
  kind: AuthorKind
  color: string
}

/** [from, to, authorId]: a run of text not written by you. */
export type Span = [number, number, string]

export type SmartField = 'search' | 'ancestorPath' | 'parentPath' | 'dateCreated' | 'dateModified' | 'kind' | 'extension'
export type SmartOp = 'matches' | 'is' | 'isNot' | 'inPast' | 'notInPast' | 'after' | 'before'

/** One condition of a smart folder, e.g. "Date modified is in the past 7 days". */
export interface SmartRule {
  field: SmartField
  op: SmartOp
  value: string
}

export interface SmartFolder {
  id: string
  name: string
  /** Older smart folders were a single search; kept for compatibility. */
  query: string
  rules?: SmartRule[]
  match?: 'all' | 'any'
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
  /** Bumped when defaults change, so untouched old defaults can be migrated. */
  settingsVersion: number
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
  markdown: {
    /** Every line break starts a new paragraph, for writing one paragraph per line. */
    singleReturnParagraphs: boolean
    /** $…$ and $$…$$ math; off keeps prices like $5 as plain text. */
    math: boolean
  }
  indent: { useTabs: boolean; width: number }
  links: {
    /** How [[wiki links]] find their document: by name anywhere in the library, or as a path from this document. */
    wikiResolve: 'name' | 'relative'
    /** What link completion inserts. */
    wikiInsert: 'name' | 'path'
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
  speakingWordsPerMinute: number
  wordsPerPage: number
  showSidebar: boolean
  showOutline: boolean
  showPreview: boolean
  /** Split: preview beside the editor. Full: preview only. */
  previewMode: 'split' | 'full'
  previewZoom: 'width' | 'page'
  previewSync: boolean
  previewTemplate: string
  exportTemplate: string
  pdfPaper: 'A4' | 'Letter' | 'Legal' | 'A5'
  libraryLocations: string[]
  librarySort: SortOrder
  librarySortReverse: boolean
  showOrganizer: boolean
  showSortBar: boolean
  showFilterBar: boolean
  showExtensions: boolean
  favorites: string[]
  recent: string[]
  smartFolders: SmartFolder[]
  authorship: {
    enabled: boolean
    /** Colour text by author. */
    showBorrowed: boolean
    /** Your name. */
    author: string
    authors: Author[]
    /** Author that pasted text is attributed to ('' = you). */
    pasteAuthor: string
    /** Keep authorship inside the document (a trailing HTML comment) so it travels with the file. */
    storeInFile: boolean
  }
  versions: { enabled: boolean; intervalMinutes: number; max: number }
  autosave: boolean
  defaultExtension: 'md' | 'markdown' | 'txt'
  publishAccounts: PublishAccount[]
  /** Secret for URL commands that read or write documents. */
  urlToken: string
  page: {
    orientation: 'portrait' | 'landscape'
    /** Margins in millimetres. */
    margins: { top: number; right: number; bottom: number; left: number }
    header: boolean
    footer: boolean
  }
}

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 2,
  theme: 'system',
  font: 'duo',
  customFont: '',
  fontSize: 19,
  lineHeight: 1.65,
  lineWidth: 'medium',
  markup: 'show',
  hangingHeadings: true,
  focusMode: 'off',
  typewriter: false,
  syntax: { adjectives: false, nouns: false, adverbs: false, verbs: false, conjunctions: false },
  styleCheck: { fillers: false, cliches: false, redundancies: false, custom: [], ignored: [] },
  markdown: { singleReturnParagraphs: false, math: true },
  indent: { useTabs: false, width: 4 },
  links: { wikiResolve: 'name', wikiInsert: 'name' },
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
  speakingWordsPerMinute: 150,
  wordsPerPage: 275,
  showSidebar: true,
  showOutline: false,
  showPreview: false,
  previewMode: 'split',
  previewZoom: 'width',
  previewSync: true,
  previewTemplate: 'classic',
  exportTemplate: 'classic',
  pdfPaper: 'A4',
  libraryLocations: [],
  librarySort: 'modified',
  librarySortReverse: false,
  showOrganizer: true,
  showSortBar: true,
  showFilterBar: true,
  showExtensions: false,
  favorites: [],
  recent: [],
  smartFolders: [],
  authorship: {
    enabled: true,
    showBorrowed: false,
    author: '',
    authors: [{ id: 'pasted', name: 'Pasted', kind: 'reference', color: '#8a8f99' }],
    pasteAuthor: 'pasted',
    storeInFile: true
  },
  versions: { enabled: true, intervalMinutes: 10, max: 200 },
  autosave: true,
  defaultExtension: 'md',
  publishAccounts: [],
  urlToken: '',
  page: { orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 }, header: true, footer: true }
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
  spans?: Span[]
  /** Hash of the text the spans refer to; a mismatch means the file changed elsewhere. */
  sha256?: string
  /** Pre-authors format: ranges of pasted text. */
  borrowed?: [number, number][]
}

export interface PdfOptions {
  page: Settings['page']
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

export interface InkstandApi {
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
  listFolders(root: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  search(roots: string[], query: string): Promise<SearchHit[]>
  smartFolder(roots: string[], folder: SmartFolder): Promise<SearchHit[]>
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
  share(path: string): Promise<void>
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

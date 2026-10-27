# FOSS Write

A focused, open-source Markdown writing app for macOS, Windows and Linux. It follows the ideas behind iA Writer: plain text files in your own folders, typography first, and tools that help you write better without getting in the way.

Licensed under the GNU AGPL v3.

## Features

**Writing**
- Distraction-free editor: Markdown shown in the text colour (or dimmed, or hidden), heading marks hanging in the margin, hanging indents for lists and quotes, a steady blue caret
- Ships with iA Writer Mono, Duo and Quattro (free under the SIL Open Font License, see `resources/app/fonts/iA-Writer-OFL.md`) plus IBM Plex Serif, or use any installed font
- Focus mode (sentence, paragraph or line) and typewriter mode that keeps your line centred, even straight after Return
- Syntax highlight for adjectives, nouns, adverbs, verbs and conjunctions
- Style check for fillers, clichés and redundancies, with replacements, an ignore list and custom word or regex patterns
- Smart quotes, dashes and ellipses; auto-paired brackets; list continuation; spell check
- Tables: add, delete and move rows and columns, align and sort columns, transpose; Tab between cells
- Transformations (Title Case, UPPER, lower, Capitalize); add date, hashtag, page break, table of contents, image link, display math; comments; callouts (`> [!NOTE]`, Tip, Important, Warning, Caution)
- Paste As plain text, Markdown, quote or code block; rich text pasted in becomes Markdown; Copy Markdown, HTML or rich text
- Read aloud (Start/Stop Speaking) in the document's language

**Authorship**
- Named authors (people, AI tools, references) with their own colours; pasted text is credited to the author you choose, typed text is yours
- Mark As, and Paste Edits From: apply an AI's revision as word-level edits, crediting only the words it changed
- Authorship is stored inside the document as a hidden comment with a checksum, so it travels with the file; edits made in other apps reset it instead of misattributing text
- A breakdown of who wrote how much in the status bar

**Library**
- Two columns, as in iA Writer: an organizer (locations, favourites, smart folders, hashtags) beside a file browser with a sort bar and a filter bar
- Search language compatible with iA Writer's: word prefixes, "phrases", #tags, `[ ]`/`[x]` tasks, `.ext`, `name:`, `^first`, AND / OR / NOT, NEAR, parentheses
- Smart folders from rules: ancestor or parent path, date created or modified, kind, extension, search
- Multi-select, Move To, New Folder with Selection, Copy Path, Get Info, drag to move or to favourite
- Quick open, command palette, go to heading, `[[wiki links]]` with completion, outline
- Version history with word-level diffs and restore; autosave; reloads when files change on disk

**Preview and output**
- Live preview, split or full, fit to width or as paper-sized pages
- Content blocks: a line like `/image.png "Caption"` embeds images, Markdown files, CSV tables and source code
- Math (KaTeX), footnotes, tables, task lists, definition lists, highlights, sub/superscript, `[TOC]`, front matter
- Export to PDF, HTML, Word (.docx), Markdown and plain text; Page Setup (paper, orientation, margins, header and footer); print; Print Plain Text
- Five built-in templates, plus iA Writer `.iatemplate` bundles
- Publish drafts to WordPress, Ghost, Medium and Micro.blog

**Settings and system**
- Single return starts a new paragraph; math on or off; tabs or spaces; wiki links by name or by path
- Reading and speaking time
- URL commands compatible with iA Writer's scheme (open, new, quick-search, read, write with add/patch and author credit, version, x-callback-url) under `foss-write://`
- Light, dark or system theme; translucent sidebar, Share menu and Dock menu on macOS; window chrome that fades while you type

## Development

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Build into `out/` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Drive the built app with Playwright, off-screen (`FW_HEADLESS=1`), through every feature |
| `npm run dist` | Package installers into `dist/` |

### Layout

- `src/main`: Electron main process (windows, menus, file system, templates, versions, PDF export, publishing)
- `src/preload`: the typed IPC bridge (`window.api`)
- `src/renderer`: the UI, made of the CodeMirror 6 editor (`editor/`), Markdown rendering and exporters (`markdown/`) and panels (`ui/`)
- `src/shared`: types and text helpers used on both sides
- `resources/templates`: built-in templates. Each template is a folder with `template.json`, `document.html` (an element marked `data-document` receives the content), and optional `header.html`, `footer.html` and `title.html` that use `data-title`, `data-author`, `data-date`, `data-page-number` and `data-page-count`.

## Known limitations

- Syntax highlight and style check are English-only.
- The interface is English-only.
- Authorship data is stored on your computer, keyed by file path. It follows renames made inside the app, but not edits made in other apps.

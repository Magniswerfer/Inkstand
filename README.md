# FOSS Write

A focused, open-source Markdown writing app for macOS, Windows and Linux. It follows the ideas behind iA Writer: plain text files in your own folders, typography first, and tools that help you write better without getting in the way.

Licensed under the GNU AGPL v3.

## Features

**Writing**
- Distraction-free editor with dimmed or hidden Markdown, heading marks hanging in the margin, and Mono, Duo, Sans, Serif or any installed font. iA Writer's free fonts are used when installed; IBM Plex ships as the fallback.
- Focus mode (sentence, paragraph or line) and typewriter mode
- Syntax highlight for adjectives, nouns, adverbs, verbs and conjunctions
- Style check for fillers, clichés and redundancies, with replacements, an ignore list and custom word or regex patterns
- Smart quotes, dashes and ellipses; auto-paired brackets; list continuation; spell check with suggestions
- Pasting rich text converts it to Markdown; dragging in files inserts content blocks or images
- Formatting shortcuts, tidy tables, footnotes, task toggles, find and replace
- Authorship: tracks which text you pasted and which you typed, highlights pasted text, and shows how much of the document is yours

**Organising**
- A library built from ordinary folders, with a file list, excerpts, favorites, recent files, hashtags, full-text search (words, "phrases", #tags, -exclusions) and saved smart folders
- Quick open, a command palette and go-to-heading
- `[[Wiki links]]` with autocompletion; ⌘-click to follow links, tags and footnotes
- Outline sidebar
- Version history with word-level diffs and restore
- Autosave, plus reloading when the file changes on disk

**Publishing**
- Live preview with scroll sync
- Content blocks: a line like `/image.png "Caption"` embeds images, Markdown files (transclusion), CSV tables and source code
- Math (KaTeX), footnotes, tables, task lists, definition lists, ==highlights==, sub/superscript, `[TOC]`, front matter
- Export to PDF (with template headers and footers), HTML (self-contained), Word (.docx), Markdown and plain text; print; copy as HTML or rich text
- Five built-in templates (Classic, Modern, Mono, Academic, Manuscript), plus import of iA Writer `.iatemplate` bundles
- Publish drafts to WordPress, Ghost, Medium and Micro.blog. Credentials are encrypted with the system keychain.

**App**
- Light, dark or system theme; multiple windows (native tabs on macOS); recent files; file associations

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
| `npm run test:e2e` | Drive the built app with Playwright and export every format |
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

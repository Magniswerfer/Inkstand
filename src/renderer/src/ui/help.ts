import { h } from './dom'
import { modal } from './overlay'

const isMac = window.api.platform === 'darwin'
const mod = isMac ? '⌘' : 'Ctrl+'
const alt = isMac ? '⌥' : 'Alt+'
const shift = isMac ? '⇧' : 'Shift+'

export const guideText = `# Welcome to Inkstand

Inkstand is a quiet place to write. Plain text files, Markdown syntax, nothing in your way. This guide is an ordinary document — edit it, play with it, delete it.

## Writing

Type. Your text is saved automatically into the library folder you are browsing. Markdown markup is dimmed so it stays out of the way; choose *View → Markdown Markup* to show or hide it.

- **Focus mode** (${mod}D) dims everything but the sentence you are writing. Pick sentence, paragraph or line in *View → Focus Mode*.
- **Typewriter mode** (${alt}${mod}Y) keeps your line in the middle of the screen.
- **Syntax highlight** (${shift}${mod}Y) colours adjectives, nouns, adverbs, verbs and conjunctions.
- **Style check** (${shift}${mod}U) underlines fillers, clichés and redundancies. Hover to replace or ignore. Add your own patterns in Settings.

## Structure

Use \`#\` for headings, \`-\` for lists, \`>\` for quotes. Open the **outline** (${alt}${mod}2) to jump between sections, or press ${shift}${mod}J to go to a heading.

## Content blocks

Put a file path on its own line, starting with a slash, to embed it:

/assets/photo.jpg "A caption"

Images show up inline. Markdown files are included in place, CSV files become tables, source files become code blocks. Drag a file into the editor to insert one.

## Links and tags

Link documents with [[double brackets]]. ${mod}-click a link to follow it. Tag with #hashtags and browse them in the library.

## Preview, export and publish

Press ${mod}R for a live preview. Export to PDF, HTML, Word, Markdown or plain text from *File → Export*. Templates control how exports look — install your own or iA Writer \`.iatemplate\` bundles in Settings → Templates. Publish drafts to WordPress, Ghost, Medium or Micro.blog with *File → Publish*.

## Your words, your history

Inkstand keeps a **version history** of every document (*File → Browse Versions*) and remembers which text you typed and which you **pasted** — the status bar shows how much of the text is yours.

Everything is plain files in folders you choose. Nothing leaves your computer unless you publish it.
`

const ROWS: [string, string, string][] = [
  ['# Heading', 'Heading 1–6', `${mod}1 … ${mod}6`],
  ['**bold**', 'Bold', `${mod}B`],
  ['_italic_', 'Italic', `${mod}I`],
  ['~~strike~~', 'Strikethrough', `${shift}${mod}X`],
  ['==highlight==', 'Highlight', `${shift}${mod}H`],
  ['`code`', 'Inline code', `${mod}E`],
  ['[text](url)', 'Link', `${mod}K`],
  ['[[Document]]', 'Wiki link', `${shift}${mod}K`],
  ['![alt](image.png)', 'Image', ''],
  ['/file.png "Caption"', 'Content block', `${shift}${mod}I`],
  ['- item', 'Bulleted list', `${alt}${mod}L`],
  ['1. item', 'Numbered list', `${alt}${mod}O`],
  ['- [ ] task', 'Task', `${alt}${mod}T`],
  ['> quote', 'Quote', `${alt}${mod}'`],
  ['```', 'Code block', `${alt}${mod}K`],
  ['---', 'Horizontal rule', ''],
  ['| a | b |', 'Table', `${alt}${shift}${mod}T`],
  ['text[^1]', 'Footnote', `${alt}${mod}R`],
  ['$E = mc^2$', 'Math (inline / $$ block)', ''],
  ['#tag', 'Tag', ''],
  ['[TOC]', 'Table of contents', ''],
  ['---\\ntitle: …\\n---', 'Front matter (title, author, date)', '']
]

export function openCheatsheet() {
  modal(
    'Markdown',
    h(
      'table',
      { class: 'cheatsheet' },
      h('thead', null, h('tr', null, h('th', null, 'Type'), h('th', null, 'For'), h('th', null, 'Shortcut'))),
      h('tbody', null, ROWS.map(([md, what, key]) => h('tr', null, h('td', null, h('code', null, md.replace(/\\n/g, ' ⏎ '))), h('td', null, what), h('td', null, key))))
    ),
    { wide: true }
  )
}

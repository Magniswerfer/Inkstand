import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, insertTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightSpecialChars, keymap, placeholder, rectangularSelection } from '@codemirror/view'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { Settings } from '@shared/types'
import { authorshipDisplay, authorshipField, setBorrowed, type Ranges } from './authorship'
import { completions, type CompletionSource } from './complete'
import { focusMode } from './focus'
import { refreshImages, inlineImages } from './images'
import { linkAt, markup, type LinkTarget } from './markup'
import { styleCheck } from './style'
import { partsOfSpeech } from './syntax'
import { highlightStyle } from './theme'
import { typewriter } from './typewriter'
import { typography } from './typography'
import { tableNextCell } from './format'

export interface EditorHost extends CompletionSource {
  onDocChanged(): void
  onSelectionChanged(): void
  resolveImage(src: string): string | null
  openLink(link: LinkTarget): void
  ignoreStylePhrase(phrase: string): void
  handleDrop(files: File[], pos: number): Promise<boolean>
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' })
turndown.use(gfm)
turndown.remove(['style', 'script', 'meta'])

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

/** True if the clipboard HTML carries real formatting worth converting (not just wrapped plain text). */
function isRichHtml(html: string) {
  return /<(h[1-6]|strong|b|em|i|a\s|ul|ol|li|blockquote|table|pre|code|img)[\s>]/i.test(html)
}

const listLine = /^\s*([-*+]|\d+[.)])\s/

export class Editor {
  readonly view: EditorView
  private c = {
    markup: new Compartment(),
    focus: new Compartment(),
    typewriter: new Compartment(),
    syntax: new Compartment(),
    style: new Compartment(),
    typography: new Compartment(),
    images: new Compartment(),
    authorship: new Compartment(),
    brackets: new Compartment(),
    attrs: new Compartment()
  }
  private settings: Settings

  constructor(parent: HTMLElement, private host: EditorHost, settings: Settings) {
    this.settings = settings
    this.view = new EditorView({ parent, state: this.createState('', settings) })
  }

  private createState(doc: string, s: Settings): EditorState {
    return EditorState.create({ doc, extensions: this.extensions(s) })
  }

  private configurable(s: Settings) {
    return {
      markup: markup(s.markup, s.hangingHeadings),
      focus: focusMode(s.focusMode),
      typewriter: typewriter(s.typewriter),
      syntax: partsOfSpeech(s.syntax),
      style: styleCheck(s.styleCheck, (p) => this.host.ignoreStylePhrase(p)),
      typography: typography({ quotes: s.smartQuotes, dashes: s.smartDashes }),
      images: inlineImages(s.inlineImages, (src) => this.host.resolveImage(src)),
      authorship: authorshipDisplay(s.authorship.enabled && s.authorship.showBorrowed),
      brackets: s.autoPair ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
      attrs: EditorView.contentAttributes.of({ spellcheck: String(s.spellcheck), autocorrect: 'off', autocapitalize: 'sentences', 'aria-label': 'Document' })
    } satisfies Record<keyof Editor['c'], Extension>
  }

  private extensions(s: Settings): Extension[] {
    const conf = this.configurable(s)
    const host = this.host
    return [
      history(),
      drawSelection({ cursorBlinkRate: 0 }),
      dropCursor(),
      rectangularSelection(),
      highlightSpecialChars(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
      syntaxHighlighting(highlightStyle),
      search({ top: true }),
      placeholder('Start writing…'),
      authorshipField,
      completions(host),
      keymap.of([
        { key: 'Tab', run: (v) => tableNextCell(v, 1), shift: (v) => tableNextCell(v, -1) },
        {
          key: 'Tab',
          run: (v) => {
            const line = v.state.doc.lineAt(v.state.selection.main.head)
            if (listLine.test(line.text) || !v.state.selection.main.empty) return indentMore(v)
            return insertTab(v)
          },
          shift: indentLess
        },
        ...completionKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap
      ]),
      ...(Object.keys(this.c) as (keyof Editor['c'])[]).map((k) => this.c[k].of(conf[k])),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) host.onDocChanged()
        if (u.docChanged || u.selectionSet) host.onSelectionChanged()
      }),
      EditorView.domEventHandlers({
        paste: (e, view) => {
          const html = e.clipboardData?.getData('text/html')
          if (!this.settings.pasteRichText || !html || !isRichHtml(html)) return false
          const md = htmlToMarkdown(html).trim()
          if (!md) return false
          e.preventDefault()
          view.dispatch(view.state.replaceSelection(md), { userEvent: 'input.paste', scrollIntoView: true })
          return true
        },
        drop: (e, view) => {
          const files = [...(e.dataTransfer?.files ?? [])]
          if (!files.length) return false
          e.preventDefault()
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
          host.handleDrop(files, pos)
          return true
        },
        mousedown: (e, view) => {
          if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos == null) return false
          const link = linkAt(view.state, pos)
          if (!link) return false
          e.preventDefault()
          host.openLink(link)
          return true
        }
      })
    ]
  }

  applySettings(s: Settings) {
    const prev = this.settings
    this.settings = s
    const conf = this.configurable(s)
    const changed = (keys: (keyof Settings)[]) => keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(s[k]))
    const effects = []
    const map: [keyof Editor['c'], (keyof Settings)[]][] = [
      ['markup', ['markup', 'hangingHeadings']],
      ['focus', ['focusMode']],
      ['typewriter', ['typewriter']],
      ['syntax', ['syntax']],
      ['style', ['styleCheck']],
      ['typography', ['smartQuotes', 'smartDashes']],
      ['images', ['inlineImages']],
      ['authorship', ['authorship']],
      ['brackets', ['autoPair']],
      ['attrs', ['spellcheck']]
    ]
    for (const [c, keys] of map) if (changed(keys)) effects.push(this.c[c].reconfigure(conf[c]))
    if (effects.length) this.view.dispatch({ effects })
  }

  /** Rebuilds decorations that depend on measured text widths (after a font change). */
  remeasure() {
    this.view.dispatch({ effects: this.c.markup.reconfigure(markup(this.settings.markup, this.settings.hangingHeadings)) })
    this.view.requestMeasure()
  }

  /** Replaces the whole document (new file opened); resets undo history. */
  setDoc(text: string, borrowed: Ranges = []) {
    this.view.setState(this.createState(text, this.settings))
    if (borrowed.length) this.view.dispatch({ effects: setBorrowed.of(borrowed.filter(([, b]) => b <= text.length)) })
  }

  /** Replaces the text but keeps undo history (reload after an external change). */
  replaceDoc(text: string) {
    const { state } = this.view
    const head = Math.min(state.selection.main.head, text.length)
    this.view.dispatch({ changes: { from: 0, to: state.doc.length, insert: text }, selection: { anchor: head }, userEvent: 'reload' })
  }

  get text() {
    return this.view.state.doc.toString()
  }

  get borrowed(): Ranges {
    return this.view.state.field(authorshipField)
  }

  selectionText(): string {
    const { state } = this.view
    return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join('\n')
  }

  refreshImages() {
    this.view.dispatch({ effects: refreshImages.of(null) })
  }

  undo() {
    undo(this.view)
  }

  redo() {
    redo(this.view)
  }

  focus() {
    this.view.focus()
  }

  scrollToPos(pos: number, select = true) {
    const p = Math.min(pos, this.view.state.doc.length)
    this.view.dispatch({ selection: select ? { anchor: p } : undefined, effects: EditorView.scrollIntoView(p, { y: 'start', yMargin: 80 }) })
    this.view.focus()
  }
}

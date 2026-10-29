import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { Settings } from '@shared/types'
import { getSettings, setSettings } from './settings'
import { checkForUpdatesNow } from './updater'

const isMac = process.platform === 'darwin'

function send(cmd: string, arg?: unknown) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu', cmd, arg)
}

const item = (label: string, cmd: string, accelerator?: string, arg?: unknown): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: () => send(cmd, arg)
})

/** Checkmarks to refresh in place when settings change; replacing the whole menu bar is slow on macOS. */
let checks: { id: string; get: (s: Settings) => boolean }[] = []

function toggle(label: string, get: (s: Settings) => boolean, patch: () => Partial<Settings>, accelerator?: string): MenuItemConstructorOptions {
  const id = `check-${checks.length}`
  checks.push({ id, get })
  return { id, label, type: 'checkbox', checked: get(getSettings()), accelerator, click: () => setSettings(patch()) }
}

function radio<const T>(label: string, value: T, get: (s: Settings) => T, patch: (v: T) => Partial<Settings>, accelerator?: string): MenuItemConstructorOptions {
  const id = `check-${checks.length}`
  checks.push({ id, get: (s) => get(s) === value })
  return { id, label, type: 'radio', checked: get(getSettings()) === value, accelerator, click: () => setSettings(patch(value)) }
}

/** Updates every checkmark from the current settings without rebuilding the menu. */
export function syncMenu() {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const s = getSettings()
  for (const c of checks) {
    const item = menu.getMenuItemById(c.id)
    const on = c.get(s)
    // Checking one radio item unchecks its siblings; never uncheck radios directly.
    if (item && item.checked !== on && (item.type !== 'radio' || on)) item.checked = on
  }
}

export function buildMenu(openRecent: (path: string) => void) {
  const s = getSettings()
  checks = []
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: checkForUpdatesNow },
              sep,
              item('Settings…', 'preferences', 'Cmd+,'),
              sep,
              { role: 'services' },
              sep,
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              sep,
              { role: 'quit' }
            ] as MenuItemConstructorOptions[]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('New', 'new', 'CmdOrCtrl+N'),
        item('New Window', 'newWindow', 'CmdOrCtrl+Shift+N'),
        item('New Folder', 'newFolder', 'CmdOrCtrl+Alt+N'),
        sep,
        item('Quick Open…', 'quickOpen', 'CmdOrCtrl+Shift+O'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        // macOS keeps its own Open Recent list (fed by app.addRecentDocument), so it never needs a rebuild.
        isMac
          ? { label: 'Open Recent', role: 'recentDocuments', submenu: [{ label: 'Clear Menu', role: 'clearRecentDocuments' }] }
          : {
              label: 'Open Recent',
              submenu: [
                ...s.recent.slice(0, 15).map((p) => ({ label: p.replace(app.getPath('home'), '~'), click: () => openRecent(p) })),
                sep,
                { label: 'Clear Menu', click: () => setSettings({ recent: [] }) }
              ]
            },
        item('Add Library Folder…', 'addLocation'),
        sep,
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        item('Rename…', 'rename'),
        item('Duplicate', 'duplicate'),
        item('Move to Trash', 'trash'),
        item('Reveal in Finder', 'reveal'),
        item('Show in Library', 'showInLibrary', 'CmdOrCtrl+Alt+Shift+R'),
        item('Get Info', 'getInfo', 'CmdOrCtrl+Alt+I'),
        item('Move To…', 'moveTo'),
        sep,
        item('Save Version', 'saveVersion', 'CmdOrCtrl+Alt+S'),
        item('Browse Versions…', 'versions'),
        sep,
        {
          label: 'Export',
          submenu: [
            item('PDF…', 'export', 'CmdOrCtrl+Shift+E', 'pdf'),
            item('HTML…', 'export', undefined, 'html'),
            item('Microsoft Word (.docx)…', 'export', undefined, 'docx'),
            item('Markdown…', 'export', undefined, 'md'),
            item('Plain Text…', 'export', undefined, 'txt')
          ]
        },
        item('Publish…', 'publish'),
        ...(isMac ? [item('Share…', 'share')] : []),
        sep,
        item('Page Setup…', 'pageSetup', 'CmdOrCtrl+Alt+P'),
        item('Print…', 'print', 'CmdOrCtrl+P'),
        item('Print Plain Text…', 'printPlain'),
        sep,
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        {
          label: 'Paste As',
          submenu: [
            item('Plain Text', 'pasteAs', 'CmdOrCtrl+Alt+Shift+V', 'plain'),
            item('Markdown', 'pasteAs', undefined, 'markdown'),
            item('Quote', 'pasteAs', undefined, 'quote'),
            item('Code Block', 'pasteAs', undefined, 'code')
          ]
        },
        { role: 'selectAll' },
        sep,
        item('Copy as HTML', 'copyHtml', 'CmdOrCtrl+Alt+C'),
        item('Copy as Rich Text', 'copyRich', 'CmdOrCtrl+Alt+Shift+C'),
        item('Copy Markdown', 'copyMarkdown'),
        sep,
        {
          label: 'Transformations',
          submenu: [
            item('Make Title Case', 'case', undefined, 'title'),
            item('Make Upper Case', 'case', 'CmdOrCtrl+Alt+U', 'upper'),
            item('Make Lower Case', 'case', 'CmdOrCtrl+Alt+Shift+U', 'lower'),
            item('Capitalize', 'case', undefined, 'capitalize')
          ]
        },
        sep,
        {
          label: 'Find',
          submenu: [
            item('Find…', 'find', 'CmdOrCtrl+F'),
            item('Find and Replace…', 'replace', 'CmdOrCtrl+Alt+F'),
            item('Find Next', 'findNext', 'CmdOrCtrl+G'),
            item('Find Previous', 'findPrev', 'CmdOrCtrl+Shift+G'),
            item('Search Library…', 'searchLibrary', 'CmdOrCtrl+Shift+F'),
            item('Filter Library', 'filter', 'CmdOrCtrl+Alt+Shift+L'),
            item('Go to Heading…', 'gotoHeading', 'CmdOrCtrl+Shift+J')
          ]
        },
        {
          label: 'Authorship',
          submenu: [
            {
              label: 'Mark As',
              submenu: [
                item(s.authorship.author || 'Me', 'markAs', 'CmdOrCtrl+Alt+M', ''),
                ...(s.authorship.authors.length ? [sep] : []),
                ...s.authorship.authors.map((a) => item(a.name, 'markAs', undefined, a.id)),
                sep,
                item('New Author…', 'markAs', undefined, 'new')
              ]
            },
            {
              label: 'Paste Edits From',
              submenu: [...s.authorship.authors.map((a) => item(a.name, 'pasteEdits', undefined, a.id)), ...(s.authorship.authors.length ? [sep] : []), item('New Author…', 'pasteEdits', undefined, 'new')]
            },
            sep,
            toggle('Show Authors', (s) => s.authorship.showBorrowed, () => ({
              authorship: { ...getSettings().authorship, showBorrowed: !getSettings().authorship.showBorrowed }
            })),
            item('Authorship Settings…', 'preferences', undefined, 'authorship')
          ]
        },
        {
          label: 'Speech',
          submenu: [item('Start Speaking', 'startSpeaking', 'CmdOrCtrl+Alt+Shift+S'), item('Stop Speaking', 'stopSpeaking', 'CmdOrCtrl+Alt+Shift+.')]
        },
        toggle('Check Spelling While Typing', (s) => s.spellcheck, () => ({ spellcheck: !getSettings().spellcheck })),
        toggle('Smart Quotes', (s) => s.smartQuotes, () => ({ smartQuotes: !getSettings().smartQuotes })),
        toggle('Smart Dashes and Ellipses', (s) => s.smartDashes, () => ({ smartDashes: !getSettings().smartDashes })),
        ...(isMac ? [] : [sep, item('Settings…', 'preferences', 'Ctrl+,')])
      ]
    },
    {
      label: 'Format',
      submenu: [
        item('Bold', 'bold', 'CmdOrCtrl+B'),
        item('Italic', 'italic', 'CmdOrCtrl+I'),
        item('Strikethrough', 'strike', 'CmdOrCtrl+Shift+X'),
        item('Highlight', 'highlight', 'CmdOrCtrl+Shift+H'),
        item('Inline Code', 'code', 'CmdOrCtrl+E'),
        item('Link', 'link', 'CmdOrCtrl+K'),
        item('Wiki Link', 'wikilink', 'CmdOrCtrl+Shift+K'),
        item('Footnote', 'footnote', 'CmdOrCtrl+Alt+R'),
        sep,
        {
          label: 'Heading',
          submenu: [1, 2, 3, 4, 5, 6].map((n) => item(`Heading ${n}`, 'heading', `CmdOrCtrl+${n}`, n)).concat([
            sep,
            item('Body Text', 'heading', 'CmdOrCtrl+0', 0)
          ])
        },
        item('Quote', 'quote', "CmdOrCtrl+Alt+'"),
        item('Bulleted List', 'bulletList', 'CmdOrCtrl+Alt+L'),
        item('Numbered List', 'numberedList', 'CmdOrCtrl+Alt+O'),
        item('Task', 'taskList', 'CmdOrCtrl+Alt+T'),
        item('Toggle Task Done', 'toggleTask', 'CmdOrCtrl+Enter'),
        item('Code Block', 'codeBlock', 'CmdOrCtrl+Alt+K'),
        sep,
        {
          label: 'Callout',
          submenu: ['Note', 'Tip', 'Important', 'Warning', 'Caution'].map((k) => item(k, 'callout', undefined, k.toLowerCase()))
        },
        item('Comment', 'comment', 'CmdOrCtrl+Alt+/'),
        sep,
        {
          label: 'Add',
          submenu: [
            item('Content Block…', 'insertBlock', 'CmdOrCtrl+Shift+I'),
            item('Image Link', 'insertImage'),
            item('Table', 'insertTable', 'CmdOrCtrl+Alt+Shift+T'),
            item('Table of Contents', 'insertToc'),
            item('Display Math', 'insertMath'),
            item('Date', 'insertDate'),
            item('Hashtag', 'insertHashtag'),
            item('Horizontal Rule', 'rule'),
            item('Page Break', 'insertPageBreak', 'CmdOrCtrl+Alt+Enter')
          ]
        },
        {
          label: 'Table',
          submenu: [
            item('Tidy Table', 'formatTable', 'CmdOrCtrl+Alt+Shift+F'),
            sep,
            item('Add Row Above', 'table', undefined, 'rowAbove'),
            item('Add Row Below', 'table', 'CmdOrCtrl+Alt+Shift+Down', 'rowBelow'),
            item('Delete Row', 'table', undefined, 'deleteRow'),
            item('Move Row Up', 'table', undefined, 'rowUp'),
            item('Move Row Down', 'table', undefined, 'rowDown'),
            sep,
            item('Add Column Before', 'table', undefined, 'colBefore'),
            item('Add Column After', 'table', 'CmdOrCtrl+Alt+Shift+Right', 'colAfter'),
            item('Delete Column', 'table', undefined, 'deleteCol'),
            item('Move Column Left', 'table', undefined, 'colLeft'),
            item('Move Column Right', 'table', undefined, 'colRight'),
            sep,
            item('Align Column Left', 'table', undefined, 'alignLeft'),
            item('Align Column Center', 'table', undefined, 'alignCenter'),
            item('Align Column Right', 'table', undefined, 'alignRight'),
            sep,
            item('Sort Column Ascending', 'table', undefined, 'sortAsc'),
            item('Sort Column Descending', 'table', undefined, 'sortDesc'),
            item('Transpose Rows and Columns', 'table', undefined, 'transpose')
          ]
        },
        sep,
        item('Indent', 'indent', 'CmdOrCtrl+]'),
        item('Outdent', 'outdent', 'CmdOrCtrl+['),
        item('Move Line Up', 'lineUp', 'Alt+Up'),
        item('Move Line Down', 'lineDown', 'Alt+Down')
      ]
    },
    {
      label: 'View',
      submenu: [
        toggle('Library', (s) => s.showSidebar, () => ({ showSidebar: !getSettings().showSidebar }), 'CmdOrCtrl+Alt+1'),
        toggle('Organizer', (s) => s.showOrganizer, () => ({ showOrganizer: !getSettings().showOrganizer }), 'CmdOrCtrl+Alt+0'),
        toggle('Sort Bar', (s) => s.showSortBar, () => ({ showSortBar: !getSettings().showSortBar })),
        toggle('Filter Bar', (s) => s.showFilterBar, () => ({ showFilterBar: !getSettings().showFilterBar })),
        {
          label: 'Sort Files By',
          submenu: [
            ...(
              [
                ['modified', 'Date Modified'],
                ['created', 'Date Created'],
                ['name', 'Name'],
                ['size', 'Size'],
                ['kind', 'Kind']
              ] as const
            ).map(([k, l]) => radio(l, k as Settings['librarySort'], (s) => s.librarySort, (v) => ({ librarySort: v }))),
            sep,
            toggle('Reverse Order', (s) => s.librarySortReverse, () => ({ librarySortReverse: !getSettings().librarySortReverse }))
          ] as MenuItemConstructorOptions[]
        },
        sep,
        toggle('Outline', (s) => s.showOutline, () => ({ showOutline: !getSettings().showOutline }), 'CmdOrCtrl+Alt+2'),
        toggle('Preview', (s) => s.showPreview, () => ({ showPreview: !getSettings().showPreview }), 'CmdOrCtrl+R'),
        {
          label: 'Preview Options',
          submenu: [
            radio('Split', 'split', (s) => s.previewMode, (v) => ({ showPreview: true, previewMode: v })),
            radio('Full', 'full', (s) => s.previewMode, (v) => ({ showPreview: true, previewMode: v }), 'CmdOrCtrl+Shift+R'),
            sep,
            radio('Fit Width', 'width', (s) => s.previewZoom, (v) => ({ showPreview: true, previewZoom: v })),
            radio('Fit Page', 'page', (s) => s.previewZoom, (v) => ({ showPreview: true, previewZoom: v })),
            sep,
            item('Reload Preview', 'reloadPreview')
          ] as MenuItemConstructorOptions[]
        },
        toggle('Stats', (s) => s.showStats, () => ({ showStats: !getSettings().showStats }), 'CmdOrCtrl+Alt+3'),
        item('Command Palette…', 'palette', 'CmdOrCtrl+Shift+P'),
        sep,
        {
          label: 'Focus Mode',
          submenu: [
            item('Toggle Focus', 'toggleFocus', 'CmdOrCtrl+D'),
            sep,
            radio('Off', 'off', (s) => s.focusMode, (v) => ({ focusMode: v })),
            radio('Sentence', 'sentence', (s) => s.focusMode, (v) => ({ focusMode: v })),
            radio('Paragraph', 'paragraph', (s) => s.focusMode, (v) => ({ focusMode: v })),
            radio('Line', 'line', (s) => s.focusMode, (v) => ({ focusMode: v }))
          ] as MenuItemConstructorOptions[]
        },
        toggle('Typewriter Mode', (s) => s.typewriter, () => ({ typewriter: !getSettings().typewriter }), 'CmdOrCtrl+Alt+Y'),
        {
          label: 'Syntax Highlight',
          submenu: [
            item('Toggle All', 'toggleSyntax', 'CmdOrCtrl+Shift+Y'),
            sep,
            ...(['adjectives', 'nouns', 'adverbs', 'verbs', 'conjunctions'] as const).map((k) =>
              toggle(k[0].toUpperCase() + k.slice(1), (s) => s.syntax[k], () => ({ syntax: { ...getSettings().syntax, [k]: !getSettings().syntax[k] } }))
            )
          ]
        },
        {
          label: 'Style Check',
          submenu: [
            item('Toggle All', 'toggleStyle', 'CmdOrCtrl+Shift+U'),
            sep,
            ...(['fillers', 'cliches', 'redundancies'] as const).map((k) =>
              toggle(k === 'cliches' ? 'Clichés' : k[0].toUpperCase() + k.slice(1), (s) => s.styleCheck[k], () => ({
                styleCheck: { ...getSettings().styleCheck, [k]: !getSettings().styleCheck[k] }
              }))
            ),
            sep,
            item('Custom Patterns…', 'preferences', undefined, 'style')
          ]
        },
        sep,
        {
          label: 'Theme',
          submenu: [
            radio('Match System', 'system', (s) => s.theme, (v) => ({ theme: v })),
            radio('Light', 'light', (s) => s.theme, (v) => ({ theme: v })),
            radio('Dark', 'dark', (s) => s.theme, (v) => ({ theme: v }), 'CmdOrCtrl+Alt+Shift+D')
          ] as MenuItemConstructorOptions[]
        },
        {
          label: 'Font',
          submenu: [
            radio('Mono', 'mono', (s) => s.font, (v) => ({ font: v })),
            radio('Duo', 'duo', (s) => s.font, (v) => ({ font: v })),
            radio('Sans', 'sans', (s) => s.font, (v) => ({ font: v })),
            radio('Serif', 'serif', (s) => s.font, (v) => ({ font: v })),
            radio('Custom', 'custom', (s) => s.font, (v) => ({ font: v }))
          ] as MenuItemConstructorOptions[]
        },
        {
          label: 'Line Width',
          submenu: [
            radio('Narrow', 'narrow', (s) => s.lineWidth, (v) => ({ lineWidth: v })),
            radio('Medium', 'medium', (s) => s.lineWidth, (v) => ({ lineWidth: v })),
            radio('Wide', 'wide', (s) => s.lineWidth, (v) => ({ lineWidth: v })),
            radio('Full Width', 'full', (s) => s.lineWidth, (v) => ({ lineWidth: v }))
          ] as MenuItemConstructorOptions[]
        },
        {
          label: 'Markdown Markup',
          submenu: [
            radio('Show', 'show', (s) => s.markup, (v) => ({ markup: v })),
            radio('Dim', 'dim', (s) => s.markup, (v) => ({ markup: v })),
            radio('Hide When Not Editing', 'hide', (s) => s.markup, (v) => ({ markup: v }))
          ] as MenuItemConstructorOptions[]
        },
        { label: 'Bigger', accelerator: 'CmdOrCtrl+=', click: () => setSettings({ fontSize: Math.min(40, getSettings().fontSize + 1) }) },
        { label: 'Smaller', accelerator: 'CmdOrCtrl+-', click: () => setSettings({ fontSize: Math.max(10, getSettings().fontSize - 1) }) },
        { label: 'Actual Size', click: () => setSettings({ fontSize: 19 }) },
        sep,
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        item('Writing Guide', 'guide'),
        item('Markdown Cheat Sheet', 'cheatsheet', 'CmdOrCtrl+/'),
        { label: 'Project Website', click: () => shell.openExternal('https://github.com/Magniswerfer/foss-write') },
        ...(isMac ? [] : [sep, { label: 'Check for Updates…', click: checkForUpdatesNow }])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

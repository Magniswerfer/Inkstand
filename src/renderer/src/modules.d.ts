// Untyped third-party modules.

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  export const gfm: TurndownService.Plugin
  export const tables: TurndownService.Plugin
  export const strikethrough: TurndownService.Plugin
}

declare module 'markdown-it-footnote'
declare module 'markdown-it-task-lists'
declare module 'markdown-it-deflist'
declare module 'markdown-it-mark'
declare module 'markdown-it-sub'
declare module 'markdown-it-sup'
declare module 'markdown-it-attrs'

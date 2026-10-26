import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Colours live in CSS (styles/editor.css) so themes only touch custom properties.
export const highlightStyle = HighlightStyle.define([
  { tag: t.heading, class: 'cm-fw-t-heading' },
  { tag: t.strong, class: 'cm-fw-t-strong' },
  { tag: t.emphasis, class: 'cm-fw-t-em' },
  { tag: t.strikethrough, class: 'cm-fw-t-strike' },
  { tag: t.link, class: 'cm-fw-t-link' },
  { tag: t.url, class: 'cm-fw-t-url' },
  { tag: t.monospace, class: 'cm-fw-t-code' },
  { tag: t.quote, class: 'cm-fw-t-quote' },
  { tag: [t.processingInstruction, t.contentSeparator], class: 'cm-fw-t-mark' },
  { tag: t.comment, class: 'cm-fw-t-comment' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], class: 'cm-fw-t-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'cm-fw-t-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'cm-fw-t-number' },
  { tag: [t.typeName, t.className, t.namespace], class: 'cm-fw-t-type' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'cm-fw-t-function' },
  { tag: [t.propertyName, t.attributeName], class: 'cm-fw-t-property' },
  { tag: [t.tagName, t.angleBracket], class: 'cm-fw-t-tag' },
  { tag: [t.meta, t.labelName], class: 'cm-fw-t-meta' },
  { tag: t.invalid, class: 'cm-fw-t-invalid' }
])

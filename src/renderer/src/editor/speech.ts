// Start / Stop Speaking: reads the selection, or from the caret to the end, in a voice matching
// the document's language, following along by selecting each word as it is spoken.
import { parseFrontMatter, splitFrontMatter } from '@shared/text'
import type { EditorView } from '@codemirror/view'
import { plainText } from '../stats'

let current: SpeechSynthesisUtterance | null = null

/** Language of the text: front matter `lang:`, a guess from letters only some languages use, or the system's. */
export function guessLanguage(doc: string): string {
  const lang = parseFrontMatter(splitFrontMatter(doc).frontMatter).lang
  if (lang) return lang
  if (/[æøå]/i.test(doc)) return 'da'
  if (/[ß]|\b(und|nicht|ist)\b/i.test(doc)) return 'de'
  if (/\b(les|est|une|avec)\b/i.test(doc) && /[éèàç]/.test(doc)) return 'fr'
  if (/\b(el|los|una|está)\b/i.test(doc) && /[ñáéíóú]/.test(doc)) return 'es'
  return navigator.language
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  const base = lang.toLowerCase().split('-')[0]
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase() && v.default) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base))
}

export function isSpeaking() {
  return speechSynthesis.speaking
}

export function stopSpeaking() {
  current = null
  speechSynthesis.cancel()
}

export function startSpeaking(view: EditorView, onEnd?: () => void) {
  stopSpeaking()
  const { state } = view
  const sel = state.selection.main
  const from = sel.empty ? sel.head : sel.from
  const to = sel.empty ? state.doc.length : sel.to
  const source = state.sliceDoc(from, to)
  // Speak what a reader sees, but keep offsets into the source so we can follow along.
  const spoken = plainText(source).trim() ? source.replace(/[*_`#>~=]|\[\^?|\]\([^)]*\)|\]/g, (m) => ' '.repeat(m.length)) : ''
  if (!spoken.trim()) return onEnd?.()
  const u = new SpeechSynthesisUtterance(spoken)
  u.lang = guessLanguage(state.doc.toString())
  const voice = voiceFor(u.lang)
  if (voice) u.voice = voice
  u.onboundary = (e) => {
    if (current !== u || e.name !== 'word') return
    const start = from + e.charIndex
    const end = start + (e.charLength || /^\S*/.exec(spoken.slice(e.charIndex))![0].length)
    view.dispatch({ selection: { anchor: start, head: Math.min(end, view.state.doc.length) }, scrollIntoView: true })
  }
  u.onend = u.onerror = () => {
    if (current === u) current = null
    onEnd?.()
  }
  current = u
  speechSynthesis.speak(u)
}

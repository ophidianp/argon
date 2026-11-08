import { useEffect, useRef } from 'react'
import { basicSetup, minimalSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

// The file's extension decides the highlighting and the chip shown next to its name.
const LANGS: Record<string, [string, () => Extension]> = {
  js: ['JS', () => javascript()],
  mjs: ['JS', () => javascript()],
  cjs: ['JS', () => javascript()],
  jsx: ['JSX', () => javascript({ jsx: true })],
  ts: ['TS', () => javascript({ typescript: true })],
  mts: ['TS', () => javascript({ typescript: true })],
  tsx: ['TSX', () => javascript({ typescript: true, jsx: true })],
  json: ['JSON', () => json()],
  css: ['CSS', () => css()],
  html: ['HTML', () => html()],
  svg: ['SVG', () => html()],
  md: ['Markdown', () => markdown()],
  mdx: ['MDX', () => markdown()],
  py: ['Python', () => python()],
}
const ext = (path: string) => path.split('.').pop()?.toLowerCase() ?? ''
export const langLabel = (path: string) => LANGS[ext(path)]?.[0] ?? (ext(path) ? ext(path).toUpperCase() : 'Text')

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text-2)', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgb(var(--ink) / 0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--accent-rgb) / 0.25) !important' },
    '.cm-foldGutter span': { color: 'var(--faint)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--text-2)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(240,164,58,0.3)' },
  },
)

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-type)' },
  { tag: t.attributeName, color: 'var(--syn-fn)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-prop)' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--syn-fn)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.meta, color: 'var(--syn-meta)' },
])

// One CodeMirror editor. Read-only for code cards; editable (with ⌘S) in the Code studio.
export function CodeView({ text, path, readOnly, onChange, onSave }: { text: string; path: string; readOnly?: boolean; onChange?: (text: string) => void; onSave?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    const lang = LANGS[ext(path)]?.[1]()
    const state = EditorState.create({
      doc: text,
      extensions: [
        readOnly ? [minimalSetup, lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false)] : basicSetup,
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (handlers.current.onSave?.(), true) }]),
        EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange?.(u.state.doc.toString())),
        theme,
        syntaxHighlighting(highlight),
        lang ?? [],
      ],
    })
    view.current = new EditorView({ state, parent: host.current! })
    return () => view.current?.destroy()
  }, [path, readOnly])

  // New text from outside (a reload) replaces the document; typing does not round-trip here.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])

  return <div ref={host} className="code-view nodrag nowheel" />
}

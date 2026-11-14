import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { TextSelection, type EditorState } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import DOMPurify from 'dompurify'
import { AlertTriangle, Eye, EyeOff, Keyboard, X } from 'lucide-react'
import { editorJsonToMarkdown } from '../../../lib/messageFormat'
import { isMultiLinePaste, looksLikeCode, normalizePastedCode } from '../../../lib/codePaste'
import { MarkdownText } from '../MarkdownRenderer'
import {
  applyComposerList,
  createRichExtensions,
  editorTextBeforeCursor,
  selectionInBlock,
  selectionInCodeBlock,
} from './extensions'
import {
  EMPTY_EDITOR_DOC,
  lockedKinds,
  lockedWarning,
  looksLikeMarkdown,
  markdownToEditorDoc,
  RAW_MARKDOWN_NODE,
  type MarkdownTarget,
} from './markdownToEditorJson'
import { markdownEnterAddsLine, markdownSourceEdit, normalizeEditorLink, replaceTextareaRange, type FormatAction } from './markdownSource'
import { useEnterToSend, useInitialEditorMode, type EditorMode } from './preferences'
import { FormatButtons, MOD_LABEL, ModeToggle, ToolbarButton } from './Toolbar'

export type MarkdownEditorHandle = {
  focus: () => void
  /** The current Markdown, with any pending change written out first. */
  getMarkdown: () => string
  /** The Rich document (drafts keep it so a restored draft keeps its exact shape). */
  getRichContent: () => JSONContent
  /** Replaces the whole text without marking it as typed. */
  setMarkdown: (markdown: string, richContent?: JSONContent | null) => void
  /** Inserts Markdown at the caret: as formatting in Rich mode, as text in Markdown mode. */
  insertMarkdown: (markdown: string) => void
  insertText: (text: string) => void
  /** Text just before the caret, for @mention triggers. */
  getTextBeforeCaret: () => string
  /** Replaces the `length` characters before the caret (an @mention query) with `text`. */
  replaceTextBeforeCaret: (length: number, text: string) => void
  clear: () => void
  getMode: () => EditorMode
}

export type MarkdownEditorProps = {
  /** Controlled Markdown. Leave undefined (with `defaultValue`) for an uncontrolled editor. */
  value?: string
  defaultValue?: string
  defaultRichContent?: JSONContent | null
  /**
   * Every change, at most once a frame. In Rich mode `richContent` is the
   * document the Markdown was written from (drafts keep it so a restored
   * draft keeps its exact shape); in Markdown mode it's undefined.
   */
  onChange?: (markdown: string, richContent?: JSONContent) => void
  /**
   * Where the text is read: `message` (the message parser) or `written`
   * (`MarkdownText`). Rich mode keeps anything that wouldn't read the same
   * there as locked Markdown. Defaults to `message` for the composer variant
   * and `written` otherwise.
   */
  target?: MarkdownTarget
  /** Names the field: "Message to Alex" becomes "Message to Alex, rich text". */
  label: string
  placeholder?: string
  /** composer: toolbar in the footer, Enter-to-send. field: toolbar on top, Enter adds a line. */
  variant?: 'composer' | 'field'
  onSubmit?: () => void
  onEscape?: () => void
  /** Runs before the editor's own keys; return true when the key was handled (mention menus). */
  onKeyDown?: (event: KeyboardEvent) => boolean
  /** The text before the caret after every edit or caret move. */
  onCaretText?: (text: string) => void
  onFiles?: (files: File[]) => void
  onBlur?: () => void
  /** Markdown-mode Preview; defaults to the written-text renderer readers see. */
  renderPreview?: (markdown: string) => ReactNode
  disabled?: boolean
  /** On the textarea in Markdown mode and the surface in Rich mode, for a <label htmlFor>. */
  id?: string
  autoFocus?: boolean
  minHeight?: number
  maxHeight?: number
  describedBy?: string
  extensions?: AnyExtension[]
  /** Composer footer, before the formatting buttons (Attach). */
  toolbarStart?: ReactNode
  /** After the formatting buttons (@ mention). */
  toolbarEnd?: ReactNode
  /** Composer: the Send button, at the end of the footer. */
  submitSlot?: ReactNode
  /** Composer: left of the Enter hint (a character count). */
  hintStart?: ReactNode
  /** Composer: what Enter does (default "send"); an edit says "save". */
  submitVerb?: string
  /** The message composer keeps the legacy ⌘U underline. */
  underlineShortcut?: boolean
  className?: string
}

type PasteNotice = { mode: 'code' | 'text' | 'markdown' | 'html'; text: string; doc: ProseMirrorNode }

const PREVIEW_DEFAULT = (markdown: string) => <MarkdownText content={markdown} />

function plainParagraphs(text: string): JSONContent[] {
  return text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
}

/** Inserts pasted text as one code block, keeping its indentation, as its own undo step. */
export function insertPastedCodeBlock(view: EditorView, text: string) {
  const { schema } = view.state
  const codeBlockType = schema.nodes.codeBlock
  if (!codeBlockType) return false
  let tr = closeHistory(view.state.tr)
  tr = tr.replaceSelectionWith(codeBlockType.create(null, text ? schema.text(text) : null))
  // Leave an empty paragraph after a trailing code block so typing can continue below it.
  if (tr.doc.lastChild?.type === codeBlockType) {
    tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
    tr = tr.setSelection(TextSelection.atEnd(tr.doc))
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Inserts editor JSON at the selection: a lone paragraph inline, anything else as blocks. */
function insertJson(editor: Editor, content: JSONContent[]) {
  const inline = content.length === 1 && content[0].type === 'paragraph'
  return editor.chain().focus().insertContent(inline ? content[0].content || [] : content).run()
}

function hasRawBlock(doc: ProseMirrorNode) {
  let found = false
  doc.forEach((node) => { if (node.type.name === RAW_MARKDOWN_NODE) found = true })
  return found
}

function rawBlockKinds(doc: ProseMirrorNode) {
  const raw: JSONContent[] = []
  doc.forEach((node) => { if (node.type.name === RAW_MARKDOWN_NODE) raw.push({ type: RAW_MARKDOWN_NODE, attrs: node.attrs }) })
  return lockedKinds({ type: 'doc', content: raw })
}

/** A key press that belongs to an input method (IME) composition, which must never send, format or pick a mention. */
export function isComposingKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>, composing = false) {
  return composing || event.isComposing || event.keyCode === 229
}

function describedByAttribute(...ids: (string | undefined)[]): Record<string, string> {
  const value = ids.filter(Boolean).join(' ')
  return value ? { 'aria-describedby': value } : {}
}

function richActive(editor: Editor | null) {
  if (!editor) return {}
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    codeBlock: editor.isActive('codeBlock'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    blockquote: editor.isActive('blockquote'),
  } satisfies Partial<Record<FormatAction, boolean>>
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const {
    value,
    defaultValue = '',
    defaultRichContent,
    label,
    placeholder = '',
    variant = 'field',
    disabled = false,
    autoFocus = false,
    minHeight,
    maxHeight,
    describedBy,
    toolbarStart,
    toolbarEnd,
    submitSlot,
    hintStart,
    submitVerb = 'send',
    underlineShortcut = false,
    className = '',
  } = props
  const composer = variant === 'composer'
  const propsRef = useRef(props)
  propsRef.current = props
  const target: MarkdownTarget = props.target ?? (composer ? 'message' : 'written')
  const targetRef = useRef(target)
  targetRef.current = target
  /** Markdown to the Rich document for this editor's readers. */
  const toDoc = useCallback((markdown: string) => markdownToEditorDoc(markdown, { target: targetRef.current }).doc, [])
  /** True from compositionstart until just after compositionend (Safari sends the IME's Enter after compositionend). */
  const composingRef = useRef(false)
  const startComposing = useCallback(() => { composingRef.current = true }, [])
  const endComposing = useCallback(() => { window.setTimeout(() => { composingRef.current = false }, 0) }, [])

  const [initialMode, rememberMode] = useInitialEditorMode()
  const [mode, setModeState] = useState<EditorMode>(initialMode)
  const modeRef = useRef(mode)
  const [enterSends, setEnterSends] = useEnterToSend()
  const enterSendsRef = useRef(enterSends)
  enterSendsRef.current = enterSends

  const initialMarkdown = value ?? defaultValue
  /** The Markdown the parent last saw (from onChange or `value`). */
  const lastEmittedRef = useRef(initialMarkdown)
  /** The current Markdown when Rich mode has nothing unwritten. */
  const markdownRef = useRef(initialMarkdown)
  const richDirtyRef = useRef(false)
  const flushFrameRef = useRef<number | null>(null)
  const [source, setSource] = useState(initialMarkdown)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [preview, setPreview] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [pasteNotice, setPasteNotice] = useState<PasteNotice | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [linkText, setLinkText] = useState('')
  const [linkError, setLinkError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [sourceInBlock, setSourceInBlock] = useState(false)
  const linkSelectionRef = useRef<{ from: number; to: number; start: number; end: number } | null>(null)
  const plainPasteNextRef = useRef(false)
  const tabExitArmedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const helpId = useId()
  const previewId = useId()
  const warningId = useId()
  const editorRef = useRef<Editor | null>(null)
  /** Content set before Tiptap created the editor (it's created after the first commit). */
  const pendingDocRef = useRef<JSONContent | null>(null)

  const announce = useCallback((text: string) => {
    setAnnouncement('')
    window.setTimeout(() => setAnnouncement(text), 30)
  }, [])

  const emit = useCallback((markdown: string, richContent?: JSONContent) => {
    markdownRef.current = markdown
    if (markdown === lastEmittedRef.current) return
    lastEmittedRef.current = markdown
    propsRef.current.onChange?.(markdown, richContent)
  }, [])

  /** Writes out Rich mode's pending change, at most once a frame while typing. */
  const flush = useCallback(() => {
    if (flushFrameRef.current !== null) {
      window.cancelAnimationFrame(flushFrameRef.current)
      flushFrameRef.current = null
    }
    const editor = editorRef.current
    if (modeRef.current === 'rich' && richDirtyRef.current && editor && !editor.isDestroyed) {
      richDirtyRef.current = false
      const json = editor.getJSON()
      emit(editorJsonToMarkdown(json), json)
    }
    return markdownRef.current
  }, [emit])

  const scheduleFlush = useCallback(() => {
    if (flushFrameRef.current !== null) return
    flushFrameRef.current = window.requestAnimationFrame(() => {
      flushFrameRef.current = null
      flush()
    })
  }, [flush])

  const submit = useCallback(() => {
    flush()
    propsRef.current.onSubmit?.()
  }, [flush])

  const openLink = useCallback(() => {
    const editor = editorRef.current
    if (modeRef.current === 'rich' && editor) {
      const { from, to } = editor.state.selection
      linkSelectionRef.current = { from, to, start: 0, end: 0 }
      setLinkText(editor.state.doc.textBetween(from, to, ' ').trim())
      setLinkHref(editor.getAttributes('link').href || '')
    } else {
      const textarea = textareaRef.current
      const start = textarea?.selectionStart ?? sourceRef.current.length
      const end = textarea?.selectionEnd ?? start
      linkSelectionRef.current = { from: 0, to: 0, start, end }
      setLinkText(sourceRef.current.slice(start, end))
      setLinkHref('')
    }
    setLinkError('')
    setLinkOpen(true)
  }, [])

  const switchModeRef = useRef<(next: EditorMode) => void>(() => undefined)

  const extensions = useMemo(() => createRichExtensions({
    placeholder: () => propsRef.current.placeholder || '',
    underlineShortcut,
    onLink: () => openLink(),
    extra: props.extensions,
  }), []) // eslint-disable-line react-hooks/exhaustive-deps -- the editor is created once; refs carry later changes

  const initialDoc = useMemo<JSONContent>(() => {
    if (defaultRichContent?.type === 'doc' && Array.isArray(defaultRichContent.content)) return defaultRichContent
    return toDoc(initialMarkdown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- initial content only

  const handlePaste = (view: EditorView, event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files || [])
    if (files.length > 0 && propsRef.current.onFiles) {
      propsRef.current.onFiles(files)
      return true
    }
    const editor = editorRef.current
    const raw = event.clipboardData?.getData('text/plain') || ''
    const html = event.clipboardData?.getData('text/html') || ''
    if (!raw || !editor) return false
    const text = normalizePastedCode(raw)

    if (selectionInCodeBlock(view.state)) {
      // Inside a code block, always paste verbatim.
      view.dispatch(view.state.tr.insertText(text).scrollIntoView())
      return true
    }
    if (plainPasteNextRef.current) {
      plainPasteNextRef.current = false
      view.dispatch(closeHistory(view.state.tr))
      insertJson(editor, plainParagraphs(text))
      return true
    }
    if (looksLikeCode(text) && insertPastedCodeBlock(view, text)) {
      setPasteNotice({ mode: 'code', text, doc: view.state.doc })
      announce('Pasted as a code block.')
      return true
    }
    if (looksLikeMarkdown(text)) {
      view.dispatch(closeHistory(view.state.tr))
      insertJson(editor, toDoc(text).content || [])
      setPasteNotice({ mode: 'markdown', text, doc: view.state.doc })
      announce('Pasted Markdown as formatting.')
      return true
    }
    if (html && /<(table|img)\b/i.test(html)) {
      view.dispatch(closeHistory(view.state.tr))
      insertJson(editor, plainParagraphs(text))
      setPasteNotice({ mode: 'html', text, doc: view.state.doc })
      return true
    }
    if (!html && isMultiLinePaste(text)) {
      // Give the default paste its own undo step, then record the document right after it lands.
      view.dispatch(closeHistory(view.state.tr))
      queueMicrotask(() => setPasteNotice({ mode: 'text', text, doc: view.state.doc }))
    }
    return false
  }

  const handleRichKeyDown = (view: EditorView, event: KeyboardEvent) => {
    // An IME's Enter or arrow keys confirm the composition: nothing else may handle them.
    if (isComposingKey(event, composingRef.current || view.composing)) return false
    if (propsRef.current.onKeyDown?.(event)) return true
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.shiftKey && event.code === 'KeyM') {
      switchModeRef.current('markdown')
      return true
    }
    if (mod && event.shiftKey && event.code === 'KeyV') {
      plainPasteNextRef.current = true
      window.setTimeout(() => { plainPasteNextRef.current = false }, 1000)
      return false
    }
    if (event.key === 'Escape') {
      if (selectionInCodeBlock(view.state)) {
        tabExitArmedRef.current = true
        return true
      }
      if (propsRef.current.onEscape) {
        propsRef.current.onEscape()
        return true
      }
      return false
    }
    if (event.key === 'Enter' && composer && propsRef.current.onSubmit) {
      if (mod) {
        submit()
        return true
      }
      if (enterSendsRef.current && !event.shiftKey && !event.altKey && !selectionInBlock(view.state)) {
        submit()
        return true
      }
    }
    return false
  }

  const editor = useEditor({
    // Create the editor after commit so concurrent rendering can't outlive Tiptap's destroy timer.
    immediatelyRender: false,
    extensions,
    content: initialDoc,
    editable: !disabled,
    autofocus: autoFocus && initialMode === 'rich' ? 'end' : false,
    editorProps: {
      attributes: (state: EditorState) => {
        // Phones must not "correct" code: no autocorrect, capitalization or spellcheck in code blocks.
        const inCode = selectionInCodeBlock(state)
        const current = propsRef.current
        return {
          class: `md-editor-surface px-3 py-2.5 text-base leading-6 text-ink outline-none sm:text-sm ${composer ? 'md-editor-surface--composer' : ''}`,
          role: 'textbox',
          ...(current.id && modeRef.current === 'rich' ? { id: current.id } : {}),
          'aria-multiline': 'true',
          'aria-label': `${current.label}, rich text`,
          ...describedByAttribute(current.describedBy, hasRawBlock(state.doc) ? warningId : ''),
          autocapitalize: inCode ? 'off' : 'sentences',
          autocorrect: inCode ? 'off' : 'on',
          spellcheck: inCode ? 'false' : 'true',
        }
      },
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      handlePaste,
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || [])
        if (files.length === 0 || !propsRef.current.onFiles) return false
        event.preventDefault()
        propsRef.current.onFiles(files)
        return true
      },
      handleKeyDown: handleRichKeyDown,
      handleDOMEvents: {
        compositionstart: () => {
          startComposing()
          return false
        },
        compositionend: () => {
          endComposing()
          return false
        },
        keydown: (view, event) => {
          // A key that belongs to an IME composition goes to the IME alone: no
          // mention pick, shortcut, send or keymap (returning true skips them
          // all without preventDefault).
          if (isComposingKey(event, composingRef.current || view.composing)) return true
          // Esc then Tab leaves a code block: let the browser move focus.
          if (event.key === 'Tab' && tabExitArmedRef.current) {
            tabExitArmedRef.current = false
            return true
          }
          if (event.key !== 'Escape' && event.key !== 'Shift') tabExitArmedRef.current = false
          return false
        },
      },
    },
    onCreate: ({ editor: created }) => {
      editorRef.current = created
      const pending = pendingDocRef.current
      pendingDocRef.current = null
      if (pending) {
        created.chain()
          .command(({ tr }) => {
            tr.setMeta('addToHistory', false)
            return true
          })
          .setContent(pending, { emitUpdate: false })
          .run()
      }
    },
    onUpdate: ({ editor: updated }) => {
      editorRef.current = updated
      if (modeRef.current !== 'rich') return
      richDirtyRef.current = true
      scheduleFlush()
      propsRef.current.onCaretText?.(editorTextBeforeCursor(updated))
    },
    onSelectionUpdate: ({ editor: updated }) => {
      if (modeRef.current === 'rich') propsRef.current.onCaretText?.(editorTextBeforeCursor(updated))
    },
    onBlur: () => {
      flush()
      propsRef.current.onBlur?.()
    },
  })
  editorRef.current = editor

  // Leaving the page or conversation writes out the last keystrokes instead of dropping them.
  // A layout cleanup runs before any passive cleanup (where a parent saves its draft) and
  // before Tiptap destroys the editor.
  useLayoutEffect(() => () => {
    flush()
  }, [flush])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!disabled, false)
  }, [disabled, editor])

  // A new label or placeholder (another conversation) refreshes the surface's attributes.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, label, placeholder, describedBy])

  const applyRichDoc = useCallback((target: Editor, doc: JSONContent) => {
    target.chain()
      .command(({ tr }) => {
        tr.setMeta('addToHistory', false)
        return true
      })
      .setContent(doc, { emitUpdate: false })
      .run()
  }, [])

  const replaceAll = useCallback((markdown: string, richContent?: JSONContent | null, emitChange = true) => {
    const current = editorRef.current
    const doc = richContent?.type === 'doc' && Array.isArray(richContent.content) ? richContent : toDoc(markdown)
    if (current && !current.isDestroyed) {
      if (modeRef.current === 'rich') applyRichDoc(current, doc)
    } else {
      pendingDocRef.current = doc
    }
    setSource(markdown)
    sourceRef.current = markdown
    richDirtyRef.current = false
    setPasteNotice(null)
    if (emitChange) emit(markdown)
    else {
      markdownRef.current = markdown
      lastEmittedRef.current = markdown
    }
  }, [applyRichDoc, emit, toDoc])

  // A controlled value that changed outside the editor (a feedback snippet, a reset after saving).
  useEffect(() => {
    if (value === undefined || value === lastEmittedRef.current) return
    replaceAll(value, null, false)
  }, [replaceAll, value])

  const setMode = useCallback((next: EditorMode, { focus = true, remember = true } = {}) => {
    const current = editorRef.current
    if (next === modeRef.current) return
    if (next === 'markdown') {
      let caret = markdownRef.current.length
      const markdown = flush()
      if (current && !current.isDestroyed) {
        // Keep the caret's block: the caret goes to the end of the same block in the Markdown.
        const index = current.state.selection.$from.index(0)
        const json = current.getJSON()
        const before = editorJsonToMarkdown({ type: 'doc', content: (json.content || []).slice(0, index + 1) })
        caret = Math.min(markdown.length, before.length)
      }
      modeRef.current = 'markdown'
      // Refresh the hidden Rich surface's attributes (its id moves to the textarea).
      if (current && !current.isDestroyed) current.view.dispatch(current.state.tr.setMeta('addToHistory', false))
      sourceRef.current = markdown
      // Commit now so focus moves to the visible text box without losing a keystroke.
      flushSync(() => {
        setSource(markdown)
        setModeState('markdown')
        setPreview(false)
        setPasteNotice(null)
      })
      announce('Markdown mode. Same text, shown as Markdown.')
      const textarea = textareaRef.current
      if (focus && textarea) {
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
      }
    } else {
      const markdown = sourceRef.current
      const caret = textareaRef.current?.selectionStart ?? markdown.length
      modeRef.current = 'rich'
      if (current && !current.isDestroyed) {
        applyRichDoc(current, toDoc(markdown))
        // Switching is never an edit: the Markdown stays exactly as typed until Rich mode changes it.
        markdownRef.current = markdown
        richDirtyRef.current = false
        const blocksBefore = markdown.slice(0, caret).trim() ? (toDoc(markdown.slice(0, caret)).content || []).filter((node) => node.type !== 'paragraph' || node.content).length : 0
        const doc = current.state.doc
        const index = Math.min(Math.max(blocksBefore - 1, 0), doc.childCount - 1)
        let position = 0
        for (let child = 0; child < index; child += 1) position += doc.child(child).nodeSize
        const end = position + doc.child(index).nodeSize
        const selection = TextSelection.near(doc.resolve(Math.max(0, end - 1)), -1)
        current.view.dispatch(current.state.tr.setSelection(selection).setMeta('addToHistory', false))
      }
      flushSync(() => {
        setModeState('rich')
        setPreview(false)
      })
      if (focus && current && !current.isDestroyed) current.view.focus()
      announce('Rich mode. Same text, shown with formatting.')
    }
    if (remember) rememberMode(next)
  }, [announce, applyRichDoc, flush, rememberMode, toDoc])

  switchModeRef.current = (next) => setMode(next)

  const toggleMode = useCallback(() => setMode(modeRef.current === 'rich' ? 'markdown' : 'rich'), [setMode])

  /** The text box's selection and scroll while Preview replaces it, restored when editing resumes. */
  const sourceViewRef = useRef<{ start: number; end: number; direction: HTMLTextAreaElement['selectionDirection']; scrollTop: number } | null>(null)

  const togglePreview = useCallback(() => {
    const textarea = textareaRef.current
    const next = !preview
    if (next && textarea) {
      sourceViewRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection, scrollTop: textarea.scrollTop }
    }
    setPreview(next)
    announce(next ? 'Preview shown. Press Preview again to edit.' : 'Editing Markdown.')
    window.requestAnimationFrame(() => {
      if (next) {
        previewRef.current?.focus()
        return
      }
      const restored = textareaRef.current
      if (!restored) return
      const saved = sourceViewRef.current
      restored.focus({ preventScroll: true })
      if (saved) {
        const length = restored.value.length
        restored.setSelectionRange(Math.min(saved.start, length), Math.min(saved.end, length), saved.direction)
        restored.scrollTop = saved.scrollTop
      }
    })
  }, [announce, preview])

  const runAction = useCallback((action: FormatAction) => {
    const current = editorRef.current
    if (action === 'link') {
      openLink()
      return
    }
    if (modeRef.current === 'rich') {
      if (!current) return
      const chain = current.chain().focus()
      if (action === 'bold') chain.toggleBold().run()
      else if (action === 'italic') chain.toggleItalic().run()
      else if (action === 'strike') chain.toggleStrike().run()
      else if (action === 'code') chain.toggleCode().run()
      else if (action === 'codeBlock') chain.toggleCodeBlock().run()
      else if (action === 'blockquote') chain.toggleBlockquote().run()
      else applyComposerList(current, action)
      return
    }
    const textarea = textareaRef.current
    if (!textarea || preview) return
    const edit = markdownSourceEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, action)
    const next = replaceTextareaRange(textarea, edit, (changed) => {
      setSource(changed)
      sourceRef.current = changed
    })
    sourceRef.current = next
    emit(next)
  }, [emit, openLink, preview])

  const applyLink = () => {
    const href = normalizeEditorLink(linkHref)
    if (!href) {
      setLinkError('Enter a website or email link, like https://example.com.')
      return
    }
    const saved = linkSelectionRef.current
    const current = editorRef.current
    if (modeRef.current === 'rich' && current && saved) {
      const max = current.state.doc.content.size
      current.commands.setTextSelection({ from: Math.min(saved.from, max), to: Math.min(saved.to, max) })
      const text = linkText.trim() || href
      const { empty } = current.state.selection
      if (empty && current.isActive('link') && !linkText.trim()) current.chain().focus().extendMarkRange('link').setLink({ href }).run()
      else {
        const chain = current.chain().focus()
        if (empty && current.isActive('link')) chain.extendMarkRange('link')
        chain.deleteSelection().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run()
      }
    } else if (saved && textareaRef.current) {
      const textarea = textareaRef.current
      const value = textarea.value.slice(0, saved.start) + (linkText || '') + textarea.value.slice(saved.end)
      const edit = markdownSourceEdit(value, saved.start, saved.start + (linkText || '').length, 'link', href)
      const next = replaceTextareaRange(textarea, { ...edit, end: saved.end }, (changed) => {
        setSource(changed)
        sourceRef.current = changed
      })
      sourceRef.current = next
      emit(next)
    }
    setLinkOpen(false)
  }

  const closeLink = () => {
    setLinkOpen(false)
    window.requestAnimationFrame(() => {
      if (modeRef.current === 'rich') editorRef.current?.commands.focus()
      else textareaRef.current?.focus()
    })
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (modeRef.current === 'rich') editorRef.current?.commands.focus()
      else textareaRef.current?.focus()
    },
    getMarkdown: () => (modeRef.current === 'rich' ? flush() : sourceRef.current),
    getRichContent: () => {
      const current = editorRef.current
      if (modeRef.current === 'rich' && current && !current.isDestroyed) return current.getJSON()
      return toDoc(sourceRef.current)
    },
    setMarkdown: (markdown, richContent) => replaceAll(markdown, richContent, true),
    insertMarkdown: (markdown) => {
      const current = editorRef.current
      if (modeRef.current === 'rich' && current) insertJson(current, toDoc(markdown).content || [])
      else insertIntoSource(markdown)
    },
    insertText: (text) => {
      const current = editorRef.current
      if (modeRef.current === 'rich' && current) current.chain().focus().insertContent(text).run()
      else insertIntoSource(text)
    },
    getTextBeforeCaret: () => {
      const current = editorRef.current
      if (modeRef.current === 'rich') return current ? editorTextBeforeCursor(current) : ''
      const caret = textareaRef.current?.selectionStart ?? sourceRef.current.length
      return sourceRef.current.slice(Math.max(0, caret - 80), caret)
    },
    replaceTextBeforeCaret: (length, text) => {
      const current = editorRef.current
      if (modeRef.current === 'rich' && current) {
        const from = current.state.selection.from
        current.chain().focus().deleteRange({ from: Math.max(0, from - length), to: from }).insertContent(text).run()
        return
      }
      const textarea = textareaRef.current
      if (!textarea) return
      const caret = textarea.selectionStart
      const start = Math.max(0, caret - length)
      const next = replaceTextareaRange(textarea, { start, end: caret, text, selectionStart: start + text.length, selectionEnd: start + text.length }, (changed) => {
        setSource(changed)
        sourceRef.current = changed
      })
      sourceRef.current = next
      emit(next)
      propsRef.current.onCaretText?.(next.slice(Math.max(0, start + text.length - 80), start + text.length))
    },
    clear: () => replaceAll('', EMPTY_EDITOR_DOC, true),
    getMode: () => modeRef.current,
  }))

  function insertIntoSource(text: string) {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? sourceRef.current.length
    const end = textarea?.selectionEnd ?? start
    if (!textarea) {
      const next = sourceRef.current.slice(0, start) + text + sourceRef.current.slice(end)
      setSource(next)
      sourceRef.current = next
      emit(next)
      return
    }
    const next = replaceTextareaRange(textarea, { start, end, text, selectionStart: start + text.length, selectionEnd: start + text.length }, (changed) => {
      setSource(changed)
      sourceRef.current = changed
    })
    sourceRef.current = next
    emit(next)
  }

  const updateSourceCaret = (textarea: HTMLTextAreaElement) => {
    setSourceInBlock(markdownEnterAddsLine(textarea.value, textarea.selectionStart))
    propsRef.current.onCaretText?.(textarea.value.slice(Math.max(0, textarea.selectionStart - 80), textarea.selectionStart))
  }

  const handleSourceKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // An IME's Enter or arrow keys confirm the composition: nothing else may handle them.
    if (isComposingKey(event.nativeEvent, composingRef.current)) return
    if (propsRef.current.onKeyDown?.(event.nativeEvent)) return
    const mod = event.metaKey || event.ctrlKey
    const textarea = event.currentTarget
    if (mod && event.shiftKey && event.code === 'KeyM') {
      event.preventDefault()
      setMode('rich')
      return
    }
    if (mod && !event.altKey) {
      const key = event.shiftKey ? `Shift+${event.code}` : event.key.toLowerCase()
      const actions: Record<string, FormatAction> = {
        b: 'bold', i: 'italic', e: 'code',
        'Shift+KeyC': 'codeBlock', 'Shift+Digit8': 'bulletList', 'Shift+Digit7': 'orderedList',
        'Shift+Digit9': 'blockquote', 'Shift+KeyX': 'strike', 'Shift+KeyU': 'link',
      }
      const action = actions[key]
      if (action && !preview) {
        event.preventDefault()
        runAction(action)
        return
      }
    }
    if (event.key === 'Escape' && propsRef.current.onEscape) {
      event.preventDefault()
      propsRef.current.onEscape()
      return
    }
    if (event.key === 'Enter' && composer && propsRef.current.onSubmit) {
      if (mod || (enterSendsRef.current && !event.shiftKey && !event.altKey && !markdownEnterAddsLine(textarea.value, textarea.selectionStart))) {
        event.preventDefault()
        submit()
      }
    }
  }

  const handleSourcePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || [])
    if (files.length > 0 && propsRef.current.onFiles) {
      event.preventDefault()
      propsRef.current.onFiles(files)
      return
    }
    // Markdown mode always pastes plain text (§9.5): the browser's own paste keeps native undo.
  }

  // The Markdown text box grows with its text, up to maxHeight.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || mode !== 'markdown' || preview) return
    textarea.style.height = 'auto'
    const ceiling = maxHeight ?? (composer ? 240 : 480)
    const floor = minHeight ?? (composer ? 48 : 160)
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight + 2, floor), ceiling)}px`
  }, [composer, maxHeight, minHeight, mode, preview, source])

  useEffect(() => {
    if (autoFocus && initialMode === 'markdown') {
      const textarea = textareaRef.current
      textarea?.focus()
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- first mount only

  // Close the phone menu and help on Escape or a tap outside.
  useEffect(() => {
    if (!menuOpen && !helpOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && containerRef.current?.querySelector('[data-md-popover]')?.contains(event.target as Node)) return
      setMenuOpen(false)
      setHelpOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [helpOpen, menuOpen])

  const richState = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || current.isDestroyed) return { pressed: {}, inBlock: false, kinds: [] as string[], noticeLive: false }
      return {
        pressed: richActive(current),
        inBlock: selectionInBlock(current.state),
        kinds: rawBlockKinds(current.state.doc),
        noticeLive: Boolean(pasteNotice && current.state.doc.eq(pasteNotice.doc)),
      }
    },
  })

  const pressed = mode === 'rich' ? richState?.pressed || {} : {}
  const inBlock = mode === 'rich' ? Boolean(richState?.inBlock) : sourceInBlock
  const kinds = mode === 'rich' ? (richState?.kinds || []) as Parameters<typeof lockedWarning>[0] : []
  const formatDisabled = disabled || (mode === 'markdown' && preview)
  const showNotice = mode === 'rich' && pasteNotice && richState?.noticeLive

  const swapPaste = () => {
    const current = editorRef.current
    const notice = pasteNotice
    setPasteNotice(null)
    if (!current || !notice || !current.state.doc.eq(notice.doc)) return
    // Only replace the paste if undo actually removed it; otherwise it would be duplicated.
    if (!current.commands.undo()) return
    if (notice.mode === 'text') {
      insertPastedCodeBlock(current.view, notice.text)
      current.commands.focus()
      setPasteNotice({ mode: 'code', text: notice.text, doc: current.state.doc })
    } else {
      insertJson(current, plainParagraphs(notice.text))
      if (notice.mode === 'code') setPasteNotice({ mode: 'text', text: notice.text, doc: current.state.doc })
    }
  }

  const hint = !composer || !propsRef.current.onSubmit
    ? null
    : enterSends
      ? inBlock
        ? `In a ${mode === 'rich' ? 'list or code block' : 'code block'}, Enter adds a line · ${MOD_LABEL}Enter ${submitVerb}s`
        : `Enter to ${submitVerb} · Shift+Enter for a new line`
      : `${MOD_LABEL}Enter to ${submitVerb} · Enter for a new line`

  const previewButton = mode === 'markdown' && (
    <ToolbarButton label="Preview" pressed={preview} onClick={togglePreview} large={!composer} className={composer ? '' : 'px-2.5'}>
      {preview ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      {!composer && <span className="text-xs">Preview</span>}
    </ToolbarButton>
  )

  // The toolbar folds into Aa when the editor itself is narrow (phones, the thread panel), not only at phone width.
  const wide = composer
    ? { show: 'hidden @min-[37.5rem]:flex', showInline: 'hidden @min-[37.5rem]:inline-flex', contents: 'hidden @min-[37.5rem]:contents', fold: '@min-[37.5rem]:hidden' }
    : { show: 'hidden @min-[36rem]:flex', showInline: 'hidden @min-[36rem]:inline-flex', contents: 'hidden @min-[36rem]:contents', fold: '@min-[36rem]:hidden' }

  const phoneMenu = (
    <div className={`relative ${wide.fold}`} data-md-popover={menuOpen ? '' : undefined}>
      <ToolbarButton label="Formatting and editor mode" expanded={menuOpen} onClick={() => { setMenuOpen((open) => !open); setHelpOpen(false) }}>
        <span className="text-sm font-bold" aria-hidden="true">Aa</span>
      </ToolbarButton>
      {menuOpen && (
        <div
          role="group"
          aria-label={`Formatting for ${label.toLowerCase()}`}
          className={`absolute z-40 w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface-raised p-2 shadow-overlay motion-safe:animate-[fadeIn_120ms_ease-out] ${composer ? 'bottom-full left-0 mb-2' : 'left-0 top-full mt-2'}`}
        >
          <p className="px-1 pb-1 text-xs font-semibold text-ink-muted">Format</p>
          <div className="grid grid-cols-4 gap-1">
            <FormatButtons pressed={pressed} disabled={formatDisabled} large onAction={(action) => { runAction(action); if (action === 'link') setMenuOpen(false) }} />
          </div>
          <p className="px-1 pb-1 pt-2 text-xs font-semibold text-ink-muted">Editor</p>
          <ModeToggle mode={mode} onChange={(next) => { setMode(next); setMenuOpen(false) }} />
        </div>
      )}
    </div>
  )

  const helpButton = composer && (
    <div className="relative" data-md-popover={helpOpen ? '' : undefined}>
      <ToolbarButton label="Formatting help" compact expanded={helpOpen} onClick={() => { setHelpOpen((open) => !open); setMenuOpen(false) }}>
        <Keyboard className="h-4 w-4" aria-hidden="true" />
      </ToolbarButton>
      {helpOpen && (
        <div id={helpId} role="dialog" aria-label="Formatting help" className="absolute bottom-full right-0 z-40 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface-raised p-3 text-sm shadow-overlay">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Enter sends messages</p>
              <p className="text-xs text-ink-muted">{enterSends ? 'Shift+Enter adds a new line' : `Enter adds a new line; ${MOD_LABEL}Enter sends`}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enterSends}
              aria-label="Enter sends messages"
              onClick={() => setEnterSends(!enterSends)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${enterSends ? 'bg-action-primary' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${enterSends ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">In a list or code block, Enter always adds a line. Saved for you on this browser.</p>
          <table className="mt-3 w-full text-left text-xs text-ink-secondary">
            <tbody>
              {[
                ['**bold**', 'bold', `${MOD_LABEL}B`],
                ['_italic_', 'italic', `${MOD_LABEL}I`],
                ['~~strike~~', 'strikethrough', `${MOD_LABEL}⇧X`],
                ['`code`', 'inline code', `${MOD_LABEL}E`],
                ['``` then Enter', 'code block', `${MOD_LABEL}⇧C`],
                ['- or 1.', 'list', `${MOD_LABEL}⇧8 / ⇧7`],
                ['>', 'quote', `${MOD_LABEL}⇧9`],
                ['', 'Rich / Markdown', `${MOD_LABEL}⇧M`],
              ].map(([syntax, name, keys]) => (
                <tr key={name}>
                  <td className="py-0.5 pr-2 font-mono">{syntax}</td>
                  <td className="py-0.5 pr-2">{name}</td>
                  <td className="py-0.5 text-right tabular-nums">{keys}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const toolbar = (
    <div role="toolbar" aria-label={`Formatting for ${label.toLowerCase()}`} className={`${wide.show} messages-toolbar-scroll min-w-0 shrink items-center gap-0.5 overflow-x-auto`}>
      <FormatButtons pressed={pressed} disabled={formatDisabled} compact={composer} onAction={runAction} />
    </div>
  )

  const surfaceStyle = { minHeight, maxHeight } as const

  return (
    <div
      ref={containerRef}
      data-md-editor=""
      data-mode={mode}
      className={`@container relative min-w-0 rounded-xl border border-line-strong bg-surface-raised transition-[border-color,box-shadow] duration-200 focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25 ${disabled ? 'opacity-70' : ''} ${className}`}
      onKeyDownCapture={(event) => {
        // ⌘⇧M works from the toolbar and Preview too.
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyM' && event.target === previewRef.current) {
          event.preventDefault()
          toggleMode()
        }
      }}
    >
      {!composer && (
        <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
          {toolbar}
          {phoneMenu}
          <span className="flex-1" />
          <ModeToggle mode={mode} onChange={(next) => setMode(next)} className={wide.showInline} />
          {previewButton}
        </div>
      )}

      {kinds.length > 0 && (
        <div id={warningId} role="status" className="flex flex-wrap items-center gap-2 border-b border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{lockedWarning(kinds)}</span>
          <button type="button" onClick={() => setMode('markdown')} className="min-h-9 rounded-lg px-2 font-semibold text-warning-900 underline underline-offset-2 hover:bg-warning-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            Edit in Markdown
          </button>
        </div>
      )}

      <div className={mode === 'rich' ? 'overflow-y-auto' : 'hidden'} style={mode === 'rich' ? surfaceStyle : undefined} data-md-rich="">
        <EditorContent editor={editor} />
      </div>
      {mode === 'markdown' && !preview && (
        <textarea
          ref={textareaRef}
          id={props.id}
          value={source}
          disabled={disabled}
          aria-label={`${label}, Markdown`}
          aria-describedby={describedBy}
          placeholder={placeholder}
          spellCheck
          autoCorrect="off"
          autoCapitalize="off"
          rows={composer ? 2 : 6}
          onChange={(event) => {
            const next = event.target.value
            setSource(next)
            sourceRef.current = next
            emit(next)
            updateSourceCaret(event.target)
          }}
          onSelect={(event) => updateSourceCaret(event.currentTarget)}
          onKeyDown={handleSourceKeyDown}
          onCompositionStart={startComposing}
          onCompositionEnd={endComposing}
          onPaste={handleSourcePaste}
          onBlur={() => propsRef.current.onBlur?.()}
          className="block w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2.5 font-mono text-base leading-6 text-ink outline-none placeholder:text-ink-disabled sm:text-sm"
        />
      )}
      {mode === 'markdown' && preview && (
        <div
          ref={previewRef}
          id={previewId}
          role="region"
          aria-label={`Preview of ${label.toLowerCase()}`}
          tabIndex={0}
          className="min-w-0 overflow-y-auto px-3 py-2.5 text-sm leading-6 text-ink [overflow-wrap:anywhere] focus-visible:outline-none"
          style={{ minHeight: minHeight ?? (composer ? 48 : 160), maxHeight }}
        >
          {source.trim() ? (propsRef.current.renderPreview || PREVIEW_DEFAULT)(source) : <p className="text-ink-muted">Nothing to preview yet.</p>}
        </div>
      )}

      {showNotice && pasteNotice && (
        <div className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs text-ink-secondary" role="status">
          <span>
            {pasteNotice.mode === 'code' && 'Pasted as code so the indentation stays.'}
            {pasteNotice.mode === 'text' && 'Pasted as text.'}
            {pasteNotice.mode === 'markdown' && `Pasted Markdown as formatting. ${MOD_LABEL}Z undoes it; ${MOD_LABEL}⇧V pastes plain text.`}
            {pasteNotice.mode === 'html' && 'Tables and images can\'t be pasted as formatting, so this was pasted as text.'}
          </span>
          <span className="flex items-center gap-1">
            {pasteNotice.mode !== 'html' && (
              <button type="button" onClick={swapPaste} className="min-h-9 rounded-lg px-2 font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {pasteNotice.mode === 'text' ? 'Paste as code instead' : pasteNotice.mode === 'code' ? 'Paste as text instead' : 'Paste as plain text instead'}
              </button>
            )}
            <button type="button" aria-label="Dismiss paste options" onClick={() => setPasteNotice(null)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}

      {linkOpen && (
        <div data-md-popover="" className="mx-2 mb-2 rounded-xl border border-line bg-surface-sunken p-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <label className="text-xs font-semibold text-ink-secondary">Text
              <input value={linkText} onChange={(event) => setLinkText(event.target.value)} className="app-control mt-1 w-full font-normal" placeholder="Optional" />
            </label>
            <label className="text-xs font-semibold text-ink-secondary">Link
              <input
                value={linkHref}
                autoFocus
                onChange={(event) => { setLinkHref(event.target.value); setLinkError('') }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); applyLink() }
                  if (event.key === 'Escape') { event.preventDefault(); closeLink() }
                }}
                className="app-control mt-1 w-full font-normal"
                placeholder="https://example.com"
                inputMode="url"
                aria-invalid={Boolean(linkError)}
              />
            </label>
            <div className="flex gap-1">
              <button type="button" onClick={applyLink} className="min-h-11 rounded-xl bg-action-primary px-3 text-sm font-semibold text-on-action hover:bg-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Add link</button>
              <button type="button" onClick={closeLink} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-ink-secondary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Cancel</button>
            </div>
          </div>
          {linkError && <p role="alert" className="mt-1 text-xs font-semibold text-danger-700">{linkError}</p>}
        </div>
      )}

      {composer && (
        <>
          <div className="flex min-w-0 items-center gap-0.5 border-t border-line px-1.5 py-1">
            {toolbarStart}
            {toolbar}
            {phoneMenu}
            <span className={wide.contents}>{toolbarEnd}</span>
            <span className="min-w-0 flex-1" />
            <ModeToggle mode={mode} onChange={(next) => setMode(next)} className={wide.showInline} />
            {previewButton}
            {helpButton}
            {submitSlot}
          </div>
          {(hint || hintStart) && (
            <div className={`${hintStart ? 'flex' : 'hidden sm:flex'} min-h-7 items-center justify-between gap-3 px-3 pb-1.5 text-xs text-ink-muted`}>
              <span className="min-w-0">{hintStart}</span>
              {hint && <span className="hidden text-right sm:inline" data-testid="composer-enter-hint">{hint}</span>}
            </div>
          )}
        </>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  )
})

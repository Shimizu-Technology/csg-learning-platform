import { Extension, Node, type AnyExtension, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Code from '@tiptap/extension-code'
import Placeholder from '@tiptap/extension-placeholder'
import TiptapLink from '@tiptap/extension-link'
import UnderlineExtension from '@tiptap/extension-underline'
import type { EditorState } from '@tiptap/pm/state'
import { RAW_MARKDOWN_NODE } from './markdownToEditorJson'

/**
 * Inline code that keeps bold and italic around it, so "**`git init`**" can be
 * written and sent (M-1). Not inclusive: text typed right after a code span
 * (or after the bold rule closes around one) is plain again.
 */
export const InlineCodeKeepsMarks = Code.extend({ excludes: '', inclusive: false })

/**
 * Markdown Rich mode can't edit (§9.6): shown as locked monospace Markdown,
 * saved byte for byte, and deleted as a whole.
 */
export const RawMarkdown = Node.create({
  name: RAW_MARKDOWN_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      markdown: { default: '', parseHTML: (element) => element.getAttribute('data-markdown') || element.textContent || '' },
      kind: { default: null, parseHTML: (element) => element.getAttribute('data-kind') },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-raw-markdown]' }]
  },
  renderHTML({ node }) {
    return ['div', {
      'data-raw-markdown': '',
      'data-markdown': node.attrs.markdown,
      'data-kind': node.attrs.kind || '',
      class: 'md-raw-block',
      contenteditable: 'false',
      'aria-label': 'Markdown Rich mode can\'t edit, saved unchanged',
    }, ['pre', {}, node.attrs.markdown]]
  },
  renderText({ node }) {
    return String(node.attrs.markdown || '')
  },
})

/**
 * How a link is written in Markdown (docs/MARKDOWN.md): `bare` writes a bare
 * URL when the text is the URL and it reads the same, otherwise
 * `[text](url)`; `angle` writes `<url>` the same way; `inline` always writes
 * `[text](url)`. Links typed, pasted or added in Rich mode are `bare`, so a
 * typed URL is stored as typed.
 */
export const MarkdownLink = TiptapLink.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      spelling: {
        default: 'bare',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-md-link') || 'bare',
        renderHTML: (attributes: Record<string, unknown>) => (attributes.spelling && attributes.spelling !== 'bare' ? { 'data-md-link': attributes.spelling } : {}),
      },
    }
  },
})

export function selectionInCodeBlock(state: EditorState) {
  return state.selection.$from.parent.type.name === 'codeBlock'
}

/** Caret in a code block or list item: Enter adds a line there instead of sending (§9.7). */
export function selectionInBlock(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name === 'codeBlock' || name === 'listItem') return true
  }
  // An opening fence typed but not converted yet ("```js" then Enter makes the block).
  return $from.parent.type.name === 'paragraph' && /^(?:```|~~~)[A-Za-z0-9_+-]*$/.test($from.parent.textContent)
}

export function editorTextBeforeCursor(editor: Editor) {
  const from = editor.state.selection.from
  return editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
}

/**
 * Starts or toggles a list. With the caret in the middle of a paragraph, the
 * text after the caret becomes the first item, as Slack does.
 */
export function applyComposerList(
  editor: Editor,
  kind: 'orderedList' | 'bulletList',
  selection?: { from: number; to: number } | null,
) {
  if (selection) {
    const maxPosition = editor.state.doc.content.size
    editor.commands.setTextSelection({
      from: Math.min(selection.from, maxPosition),
      to: Math.min(selection.to, maxPosition),
    })
  }

  const toggle = () => kind === 'orderedList'
    ? editor.chain().focus().toggleOrderedList().run()
    : editor.chain().focus().toggleBulletList().run()
  const { empty, $from } = editor.state.selection

  if (!editor.isActive(kind) && empty && $from.parent.isTextblock && $from.parentOffset > 0) {
    const split = editor.chain().focus().splitBlock().run()
    if (!split) return false
  }

  return toggle()
}

export function applyComposerListShortcut(
  editor: Editor,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'code' | 'preventDefault'>,
  selection?: { from: number; to: number } | null,
) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return false

  const kind = event.code === 'Digit7'
    ? 'orderedList'
    : event.code === 'Digit8'
      ? 'bulletList'
      : null
  if (!kind) return false

  event.preventDefault()
  applyComposerList(editor, kind, selection)
  return true
}

/**
 * The §9.4 shortcuts StarterKit doesn't bind, and code-block Enter: Enter on
 * an empty last line leaves the block. ⌘Z right after a typing rule undoes the
 * formatting and keeps the characters.
 */
export const MarkdownEditorKeymap = Extension.create<{ onLink: () => void }>({
  name: 'markdownEditorKeymap',
  priority: 1000,
  addOptions() {
    return { onLink: () => undefined }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor.commands.undoInputRule(),
      'Mod-Shift-c': () => this.editor.chain().focus().toggleCodeBlock().run(),
      'Mod-Alt-c': () => this.editor.chain().focus().toggleCodeBlock().run(),
      'Mod-Shift-9': () => this.editor.chain().focus().toggleBlockquote().run(),
      'Mod-Shift-7': () => applyComposerList(this.editor, 'orderedList'),
      'Mod-Shift-8': () => applyComposerList(this.editor, 'bulletList'),
      'Mod-Shift-x': () => this.editor.chain().focus().toggleStrike().run(),
      'Mod-Shift-u': () => {
        this.options.onLink()
        return true
      },
      Enter: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'codeBlock') return false
        const atEnd = $from.parentOffset === $from.parent.content.size
        const text = $from.parent.textContent
        if (!atEnd || !text.endsWith('\n')) return false
        return this.editor.chain()
          .command(({ tr }) => {
            tr.delete($from.pos - 1, $from.pos)
            return true
          })
          .exitCode()
          .run()
      },
    }
  },
})

export type RichExtensionOptions = {
  placeholder?: string | (() => string)
  /** The message composer keeps the legacy ⌘U underline; written text has no underline syntax. */
  underlineShortcut?: boolean
  onLink: () => void
  extra?: AnyExtension[]
}

export function createRichExtensions({ placeholder = '', underlineShortcut = false, onLink, extra = [] }: RichExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      link: false,
      underline: false,
      code: false,
      horizontalRule: false,
      heading: { levels: [2, 3] },
      codeBlock: {
        enableTabIndentation: true,
        tabSize: 2,
        exitOnTripleEnter: false,
        HTMLAttributes: { class: 'md-code-block', spellcheck: 'false' },
      },
    }),
    InlineCodeKeepsMarks,
    // Kept in the schema so a legacy ++underline++ message round-trips.
    underlineShortcut ? UnderlineExtension : UnderlineExtension.extend({ addKeyboardShortcuts: () => ({}) }),
    MarkdownLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' }),
    Placeholder.configure({ placeholder: typeof placeholder === 'function' ? () => placeholder() : placeholder }),
    RawMarkdown,
    MarkdownEditorKeymap.configure({ onLink }),
    ...extra,
  ]
}

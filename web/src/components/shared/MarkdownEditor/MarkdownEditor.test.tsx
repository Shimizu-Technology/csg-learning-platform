// @vitest-environment jsdom
import { act, createRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lanceNov11Markdown } from '../../../lib/markdownFixtures'
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorProps } from './MarkdownEditor'
import { editorPreferencesKey, readEditorPreferences, writeEditorPreferences } from './preferences'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  window.localStorage.clear()
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  document.execCommand = vi.fn(() => false)
  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  Range.prototype.getBoundingClientRect = (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })) as Range['getBoundingClientRect']
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })

async function mount(props: Partial<MarkdownEditorProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const ref = createRef<MarkdownEditorHandle>()
  const onChange = vi.fn()
  await act(async () => root!.render(<MarkdownEditor ref={ref} label="Message" onChange={onChange} {...props} />))
  await tick()
  const host = container
  const surface = () => host.querySelector('[role="textbox"]') as HTMLElement
  const editor = () => (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
  const textarea = () => host.querySelector('textarea') as HTMLTextAreaElement
  const button = (name: string) => Array.from(host.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === name || candidate.textContent === name) as HTMLButtonElement
  return { ref, onChange, host, surface, editor, textarea, button }
}

/** Types like a keyboard: each character goes through the input rules. */
function type(editor: Editor, text: string) {
  for (const character of text) {
    act(() => {
      const { view } = editor
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
    })
  }
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, code: options.code, bubbles: true, cancelable: true, ...options })
  act(() => { target.dispatchEvent(event) })
  return event
}

function paste(target: HTMLElement, text: string, html = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [], types: html ? ['text/plain', 'text/html'] : ['text/plain'], getData: (kind: string) => (kind === 'text/plain' ? text : kind === 'text/html' ? html : '') } })
  act(() => { target.dispatchEvent(event) })
  return event
}

describe('Rich typing rules (§9.4)', () => {
  it('turns **bold**, _italic_ and backticks into formatting as the closing mark is typed', async () => {
    const { ref, editor } = await mount()
    type(editor(), '**bold** and _it_ and `code` ')
    expect(ref.current!.getMarkdown()).toBe('**bold** and _it_ and `code`')
  })

  it('writes bold around inline code', async () => {
    const { ref, editor } = await mount()
    type(editor(), '**`git init`** first')
    expect(ref.current!.getMarkdown()).toBe('**`git init`** first')
    expect(editor().getJSON().content?.[0].content?.[0].marks?.map((mark) => mark.type).sort()).toEqual(['bold', 'code'])
  })

  it('starts lists, quotes and headings from line-start markers', async () => {
    const { ref, editor } = await mount()
    type(editor(), '- one')
    expect(ref.current!.getMarkdown()).toBe('- one')
    act(() => { editor().commands.setContent('<p></p>') })
    type(editor(), '1. first')
    expect(ref.current!.getMarkdown()).toBe('1. first')
    act(() => { editor().commands.setContent('<p></p>') })
    type(editor(), '> said')
    expect(ref.current!.getMarkdown()).toBe('> said')
    act(() => { editor().commands.setContent('<p></p>') })
    type(editor(), '## Week 10')
    expect(ref.current!.getMarkdown()).toBe('## Week 10')
  })

  it('opens a code block from ``` and Enter, and leaves it on an empty last line', async () => {
    const { ref, editor, surface } = await mount()
    type(editor(), '```js')
    press(surface(), 'Enter')
    expect(editor().isActive('codeBlock')).toBe(true)
    expect(editor().getAttributes('codeBlock').language).toBe('js')
    type(editor(), 'x = 1')
    press(surface(), 'Enter')
    type(editor(), '**not bold**')
    press(surface(), 'Enter')
    press(surface(), 'Enter')
    expect(editor().isActive('codeBlock')).toBe(false)
    type(editor(), 'after')
    expect(ref.current!.getMarkdown()).toBe('```js\nx = 1\n**not bold**\n```\n\nafter')
  })

  it('undoes a typing rule with ⌘Z and keeps the characters, escaped when saved', async () => {
    const { ref, editor, surface } = await mount()
    type(editor(), '**b**')
    expect(editor().isActive('bold') || editor().getJSON().content?.[0].content?.[0].marks?.[0].type === 'bold').toBe(true)
    press(surface(), 'z', { ctrlKey: true, code: 'KeyZ' })
    expect(ref.current!.getMarkdown()).toBe('\\*\\*b\\*\\*')
  })
})

describe('Enter in the composer (§9.7)', () => {
  it('sends on Enter by default; Shift+Enter, lists and code blocks add a line', async () => {
    const onSubmit = vi.fn()
    const { editor, surface, host } = await mount({ variant: 'composer', onSubmit })
    expect(host.textContent).toContain('Enter to send · Shift+Enter for a new line')
    type(editor(), 'hi')
    press(surface(), 'Enter')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    press(surface(), 'Enter', { shiftKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    act(() => { editor().commands.setContent('<ul><li><p>item</p></li></ul>') })
    act(() => { editor().commands.setTextSelection(7) })
    await tick()
    expect(host.textContent).toContain('In a list or code block, Enter adds a line')
    press(surface(), 'Enter')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    press(surface(), 'Enter', { ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('with the setting off, Enter adds a line and ⌘/Ctrl+Enter sends, and the choice is saved', async () => {
    const onSubmit = vi.fn()
    const { editor, surface, host, button } = await mount({ variant: 'composer', onSubmit })
    act(() => button('Formatting help').click())
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    act(() => toggle.click())
    expect(readEditorPreferences(undefined).enterSends).toBe(false)
    expect(host.textContent).toMatch(/(⌘|Ctrl\+)Enter to send · Enter for a new line/)
    type(editor(), 'hi')
    press(surface(), 'Enter')
    expect(onSubmit).not.toHaveBeenCalled()
    press(surface(), 'Enter', { ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('in Markdown mode, Enter inside an open ``` fence adds a line', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    const onSubmit = vi.fn()
    const { textarea, host } = await mount({ variant: 'composer', onSubmit, defaultValue: '```js' })
    const box = textarea()
    act(() => { box.focus(); box.setSelectionRange(5, 5) })
    act(() => { box.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true })) })
    expect(press(box, 'Enter').defaultPrevented).toBe(false)
    expect(host.textContent).toContain('In a code block, Enter adds a line')
    expect(onSubmit).not.toHaveBeenCalled()
    act(() => { box.value = '```js\nx\n```'; box.setSelectionRange(box.value.length, box.value.length) })
    expect(press(box, 'Enter').defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('field editors never submit on Enter', async () => {
    const onSubmit = vi.fn()
    const { editor, surface } = await mount({ variant: 'field', onSubmit })
    type(editor(), 'hi')
    press(surface(), 'Enter')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('switching modes (§9.1, §9.2)', () => {
  it("is lossless for Lance's reply, isn't an edit, and is remembered for the next editor", async () => {
    const { ref, onChange, textarea, button, host } = await mount({ defaultValue: lanceNov11Markdown })
    expect(ref.current!.getMarkdown()).toBe(lanceNov11Markdown)
    act(() => button('Markdown').click())
    // Focus stays in the editor: the text box has it right after the switch, before any frame or timer.
    expect(document.activeElement).toBe(textarea())
    expect(textarea().value).toBe(lanceNov11Markdown)
    // Then the live region announces the switch.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(textarea().getAttribute('aria-label')).toBe('Message, Markdown')
    expect(button('Markdown').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe('Markdown mode. Same text, shown as Markdown.')
    act(() => button('Rich').click())
    await tick()
    expect(ref.current!.getMarkdown()).toBe(lanceNov11Markdown)
    act(() => button('Markdown').click())
    await tick()
    expect(onChange).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(editorPreferencesKey(undefined))!).mode).toBe('markdown')

    act(() => root?.unmount())
    container?.remove()
    const next = await mount({ defaultValue: 'next editor' })
    expect(next.textarea().value).toBe('next editor')
  })

  it('switches with ⌘⇧M (Ctrl+Shift+M) from either mode', async () => {
    const { surface, textarea } = await mount({ defaultValue: 'x' })
    press(surface(), 'M', { ctrlKey: true, shiftKey: true, code: 'KeyM' })
    await tick()
    expect(textarea()).not.toBeNull()
    press(textarea(), 'M', { ctrlKey: true, shiftKey: true, code: 'KeyM' })
    await tick()
    expect(textarea()).toBeNull()
  })

  it('shows Preview in Markdown mode through the renderer, as a labeled region', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    const { button, host } = await mount({ defaultValue: '**Bold** `code`' })
    const preview = button('Preview')
    expect(preview.getAttribute('aria-pressed')).toBe('false')
    act(() => preview.click())
    await tick()
    const region = host.querySelector('[role="region"]')!
    expect(region.getAttribute('aria-label')).toBe('Preview of message')
    expect(region.querySelector('strong')?.textContent).toBe('Bold')
    expect(button('Preview').getAttribute('aria-pressed')).toBe('true')
    expect(button('Bold').disabled).toBe(true)
  })

  it('locks Markdown Rich mode cannot edit, with a warning and Edit in Markdown', async () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |'
    const { ref, host, button, textarea } = await mount({ defaultValue: `Results:\n\n${table}` })
    const warning = host.querySelector('[role="status"]')!
    expect(warning.textContent).toContain("Rich mode can't edit a table. It's shown as Markdown text and saved unchanged.")
    expect(host.querySelector('.md-raw-block pre')?.textContent).toBe(table)
    expect(ref.current!.getMarkdown()).toBe(`Results:\n\n${table}`)
    act(() => button('Edit in Markdown').click())
    await tick()
    expect(textarea().value).toBe(`Results:\n\n${table}`)
  })
})

describe('paste in Rich mode (§9.5)', () => {
  it('converts pasted Markdown to formatting and says how to undo it', async () => {
    const { ref, surface, host } = await mount()
    expect(paste(surface(), '**Fix it** with `git status`\n\n- one\n- two').defaultPrevented).toBe(true)
    expect(ref.current!.getMarkdown()).toBe('**Fix it** with `git status`\n\n- one\n- two')
    await tick()
    expect(host.textContent).toMatch(/Pasted Markdown as formatting\. (⌘|Ctrl\+)Z undoes it/)
  })

  it('pastes code as a code block that keeps its indentation, with a switch to text', async () => {
    const python = 'def total(items):\n    result = 0\n    return result'
    const { ref, surface, host, button } = await mount()
    paste(surface(), python)
    expect(ref.current!.getMarkdown()).toBe(`\`\`\`\n${python}\n\`\`\``)
    await tick()
    expect(host.textContent).toContain('Pasted as code so the indentation stays.')
    act(() => button('Paste as text instead').click())
    expect(ref.current!.getMarkdown()).not.toContain('```')
  })

  it('pastes plain text after ⌘⇧V', async () => {
    const { ref, surface } = await mount()
    press(surface(), 'V', { ctrlKey: true, shiftKey: true, code: 'KeyV' })
    paste(surface(), '**literal**')
    expect(ref.current!.getMarkdown()).toBe('\\*\\*literal\\*\\*')
  })
})

describe('accessibility (§9.8)', () => {
  it('labels the surface, toolbar, buttons and mode toggle', async () => {
    const { surface, host, button } = await mount({ label: 'Overall feedback' })
    expect(surface().getAttribute('aria-label')).toBe('Overall feedback, rich text')
    expect(surface().getAttribute('aria-multiline')).toBe('true')
    const toolbar = host.querySelector('[role="toolbar"]')!
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting for overall feedback')
    const buttons = Array.from(toolbar.querySelectorAll('button'))
    expect(buttons.filter((candidate) => candidate.tabIndex === 0)).toHaveLength(1)
    expect(button('Bold').getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+B$/)
    expect(button('Bold').getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('[role="group"][aria-label="Editor mode"]')).not.toBeNull()
    expect(button('Rich').getAttribute('aria-pressed')).toBe('true')
    // Arrow keys move between toolbar buttons.
    buttons[0].focus()
    press(buttons[0], 'ArrowRight')
    expect(document.activeElement).toBe(buttons[1])
  })

  it('shows bold as pressed at the caret', async () => {
    const { editor, button } = await mount()
    type(editor(), '**on**')
    act(() => { editor().commands.setTextSelection(2) })
    await tick()
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('controlled value', () => {
  it('takes changes made outside the editor, like an inserted feedback snippet', async () => {
    function Harness() {
      const [value, setValue] = useState('Start')
      return (
        <>
          <MarkdownEditor label="Feedback" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue((current) => `${current}\n\n**Snippet**`)}>Add snippet</button>
          <output>{value}</output>
        </>
      )
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(<Harness />))
    await tick()
    const add = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === 'Add snippet')!
    act(() => add.click())
    await tick()
    expect(container.querySelector('.ProseMirror strong')?.textContent).toBe('Snippet')
    expect(container.querySelector('output')?.textContent).toBe('Start\n\n**Snippet**')
  })
})

describe('review round 1', () => {
  it.each(['rich', 'markdown'] as const)('ignores composing keys in %s mode: no send, no onKeyDown', async (mode) => {
    writeEditorPreferences(undefined, { mode })
    const onSubmit = vi.fn()
    const onKeyDown = vi.fn(() => false)
    const { surface, textarea } = await mount({ variant: 'composer', onSubmit, onKeyDown, defaultValue: 'hi' })
    const target = mode === 'rich' ? surface() : textarea()
    expect(press(target, 'Enter', { isComposing: true }).defaultPrevented).toBe(false)
    expect(press(target, 'Enter', { keyCode: 229 }).defaultPrevented).toBe(false)
    act(() => { target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    press(target, 'Enter')
    act(() => { target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
    // ProseMirror ignores one Enter within 500 ms of compositionend in Safari (jsdom reports Apple's vendor).
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, mode === 'rich' ? 520 : 5)) })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
    press(target, 'Enter')
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('writes out the last Rich keystrokes, with the document, when it unmounts before the next frame', async () => {
    const { editor, onChange } = await mount()
    type(editor(), 'last words')
    expect(onChange).not.toHaveBeenCalled()
    act(() => root!.unmount())
    root = null
    expect(onChange).toHaveBeenLastCalledWith('last words', expect.objectContaining({ type: 'doc' }))
  })

  it('keeps the text box selection and scroll position across Preview', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    const text = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const { textarea, button } = await mount({ defaultValue: text })
    act(() => {
      textarea().focus()
      textarea().setSelectionRange(20, 26)
      textarea().scrollTop = 120
    })
    act(() => button('Preview').click())
    await tick()
    expect(textarea()).toBeNull()
    act(() => button('Preview').click())
    await tick()
    expect(document.activeElement).toBe(textarea())
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([20, 26])
    expect(textarea().scrollTop).toBe(120)
  })

  it('checks long-form fields against the written renderer and the composer against messages', async () => {
    const lazy = '- first\nlazy continuation'
    const field = await mount({ defaultValue: lazy })
    expect(field.host.querySelector('.md-raw-block pre')?.textContent).toBe(lazy)
    act(() => root!.unmount())
    container?.remove()
    const composer = await mount({ defaultValue: lazy, variant: 'composer' })
    expect(composer.host.querySelector('.md-raw-block')).toBeNull()
  })
})

describe('review round 2', () => {
  it.each(['rich', 'markdown'] as const)('inserts text from the handle literally in %s mode, never as HTML', async (mode) => {
    writeEditorPreferences(undefined, { mode })
    const { ref, host, editor, textarea } = await mount()
    act(() => ref.current!.insertText('<b>literal</b> @'))
    act(() => ref.current!.replaceTextBeforeCaret(1, '<i>@Ada</i> '))
    const shown = mode === 'rich' ? editor().getText() : textarea().value
    expect(shown).toBe('<b>literal</b> <i>@Ada</i> ')
    expect(host.querySelector('.ProseMirror strong, .ProseMirror em')).toBeNull()
    if (mode === 'rich') {
      act(() => button(host, 'Markdown').click())
      expect(textarea().value).toBe(ref.current!.getMarkdown())
    }
    // Readers see the same characters whichever mode inserted them.
    expect(ref.current!.getMarkdown().replace(/\\/g, '').trimEnd()).toBe('<b>literal</b> <i>@Ada</i>')
  })

  it('keeps trailing newlines when pasting inside a code block', async () => {
    const { ref, surface, editor } = await mount()
    act(() => { editor().commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }] }) })
    act(() => { editor().commands.setTextSelection(2) })
    expect(paste(surface(), 'first\r\n\n').defaultPrevented).toBe(true)
    expect(editor().getJSON().content?.[0]).toEqual({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'xfirst\n\n' }] })
    type(editor(), 'next')
    expect(ref.current!.getMarkdown()).toBe('```\nxfirst\n\nnext\n```')
  })

  it('Enter in the link Text field moves to an empty Link field, then adds the link, inside a form without submitting it', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const ref = createRef<MarkdownEditorHandle>()
    await act(async () => root!.render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <MarkdownEditor ref={ref} label="Response" />
        <button type="submit">Send response</button>
      </form>,
    ))
    await tick()
    const host = container
    act(() => button(host, 'Link').click())
    await tick()
    const [textInput, hrefInput] = Array.from(host.querySelectorAll('[data-md-popover] input')) as HTMLInputElement[]
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { textInput.focus(); setValue.call(textInput, 'the guide'); textInput.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(press(textInput, 'Enter').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(hrefInput)
    act(() => { setValue.call(hrefInput, 'guides.rubyonrails.org'); hrefInput.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => textInput.focus())
    expect(press(textInput, 'Enter').defaultPrevented).toBe(true)
    await tick()
    expect(host.querySelector('[data-md-popover] input')).toBeNull()
    expect(ref.current!.getMarkdown()).toBe('[the guide](https://guides.rubyonrails.org)')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the Enter-to-send choice for this session when the browser cannot store it', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('QuotaExceededError') })
    try {
      const onSubmit = vi.fn()
      const { host, button: find, editor, surface } = await mount({ variant: 'composer', onSubmit })
      act(() => find('Formatting help').click())
      const toggle = () => host.querySelector('[role="switch"]') as HTMLButtonElement
      act(() => toggle().click())
      await tick()
      expect(toggle().getAttribute('aria-checked')).toBe('false')
      expect(readEditorPreferences(undefined).enterSends).toBe(false)
      type(editor(), 'hi')
      press(surface(), 'Enter')
      expect(onSubmit).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
      writeEditorPreferences(undefined, { enterSends: true })
    }
    expect(readEditorPreferences(undefined).enterSends).toBe(true)
  })

  it('gives the Enter switch and mode buttons 44px touch targets on phones', async () => {
    const { host, button: find } = await mount({ variant: 'composer' })
    act(() => find('Formatting help').click())
    expect(host.querySelector('[role="switch"]')!.className).toMatch(/\bmin-h-11\b/)
    for (const name of ['Rich', 'Markdown']) expect(find(name).className).toMatch(/(^|\s)min-h-11(\s|$)/)
  })
})

function button(host: HTMLElement, name: string) {
  return Array.from(host.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === name || candidate.textContent === name) as HTMLButtonElement
}

// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEditorPreferences } from '../../components/shared/MarkdownEditor'
import { MessageComposer, type MessageComposerHandle } from './Messages'

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
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

const tick = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
const people = [{ id: 5, full_name: 'Alex Cruz', email: 'alex@example.com', role: 'student' as const, cohort_name: null }]

async function mountComposer(draftKey: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onSend = vi.fn(() => true)
  const ref = createRef<MessageComposerHandle>()
  const render = (key: string) => act(async () => root!.render(
    <MessageComposer
      ref={ref}
      draftKey={key}
      label="Message #general"
      placeholder="Write a message"
      mentionableUsers={people as never}
      mentionPatterns={[]}
      includeChannelMentions={false}
      hasAttachments={false}
      sending={false}
      inThreadPanel={false}
      onSend={onSend}
      onTyping={() => undefined}
      onFiles={() => undefined}
      onAttach={() => undefined}
    />,
  ))
  await render(draftKey)
  await tick()
  const host = container
  return {
    host,
    onSend,
    render,
    editor: () => (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor,
    textarea: () => host.querySelector('textarea') as HTMLTextAreaElement,
  }
}

function typeRich(editor: Editor, text: string) {
  for (const character of text) {
    act(() => {
      const { view } = editor
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
    })
  }
}

function typeSource(textarea: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    textarea.focus()
    setValue.call(textarea, textarea.value + text)
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  act(() => { target.dispatchEvent(event) })
  return event
}

const savedDraft = (key: string) => JSON.parse(window.localStorage.getItem(key) || 'null') as { body: string; content: { type: string } } | null

describe('composer drafts keep the last keystrokes (review round 1)', () => {
  it('saves what was typed in Rich mode when the composer unmounts before the debounce', async () => {
    const { editor } = await mountComposer('draft:a')
    typeRich(editor(), 'typed just now')
    // No frame, no 250 ms debounce: leave right away.
    act(() => root!.unmount())
    root = null
    expect(savedDraft('draft:a')?.body).toBe('typed just now')
    expect(savedDraft('draft:a')?.content.type).toBe('doc')
  })

  it('saves what was typed in Markdown mode when the composer unmounts before the debounce', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    const { textarea } = await mountComposer('draft:b')
    typeSource(textarea(), 'typed **now**')
    act(() => root!.unmount())
    root = null
    expect(savedDraft('draft:b')?.body).toBe('typed **now**')
  })

  it('saves the last keystrokes when the tab is closed or reloaded (pagehide)', async () => {
    const { editor } = await mountComposer('draft:c')
    typeRich(editor(), 'closing the tab')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(savedDraft('draft:c')?.body).toBe('closing the tab')
  })

  it('keeps each conversation’s draft when switching right after typing, and restores it', async () => {
    const { editor, render, host } = await mountComposer('draft:one')
    typeRich(editor(), 'for one')
    await render('draft:two')
    expect(savedDraft('draft:one')?.body).toBe('for one')
    await tick()
    expect(host.querySelector('.ProseMirror')!.textContent).toBe('')
    typeRich(editor(), 'for two')
    await render('draft:one')
    await tick()
    expect(savedDraft('draft:two')?.body).toBe('for two')
    expect(host.querySelector('.ProseMirror')!.textContent).toBe('for one')
  })
})

describe('IME composition never picks a mention or sends (review round 1)', () => {
  it('Rich mode: the Enter that confirms a composition leaves the mention menu alone', async () => {
    const { editor, host, onSend } = await mountComposer('draft:ime-rich')
    typeRich(editor(), '@Al')
    await tick()
    expect(host.textContent).toContain('Mention someone')
    const surface = host.querySelector('[role="textbox"]') as HTMLElement
    press(surface, 'Enter', { isComposing: true })
    press(surface, 'Enter', { keyCode: 229 })
    await tick()
    expect(editor().getText()).toBe('@Al')
    expect(onSend).not.toHaveBeenCalled()
    // After the composition, Enter picks the person.
    press(surface, 'Enter')
    await tick()
    expect(editor().getText()).toBe('@Alex Cruz ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Markdown mode: the Enter that confirms a composition leaves the mention menu alone', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    const { textarea, host, onSend } = await mountComposer('draft:ime-markdown')
    typeSource(textarea(), '@Al')
    await tick()
    expect(host.textContent).toContain('Mention someone')
    act(() => { textarea().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    expect(press(textarea(), 'Enter').defaultPrevented).toBe(false)
    act(() => { textarea().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
    expect(press(textarea(), 'Enter', { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(press(textarea(), 'Tab', { isComposing: true }).defaultPrevented).toBe(false)
    await tick()
    expect(textarea().value).toBe('@Al')
    expect(onSend).not.toHaveBeenCalled()
    expect(press(textarea(), 'Enter').defaultPrevented).toBe(true)
    await tick()
    expect(textarea().value).toBe('@Alex Cruz ')
  })
})

describe('review round 2', () => {
  it.each(['rich', 'markdown'] as const)('picking a mention replaces only the active @token in %s mode', async (mode) => {
    writeEditorPreferences(undefined, { mode })
    const { editor, textarea, host } = await mountComposer(`draft:mention-${mode}`)
    if (mode === 'rich') typeRich(editor(), 'Hi @Ada and @Al')
    else typeSource(textarea(), 'Hi @Ada and @Al')
    await tick()
    expect(host.textContent).toContain('Mention someone')
    press((mode === 'rich' ? host.querySelector('[role="textbox"]') : textarea()) as HTMLElement, 'Enter')
    await tick()
    expect(mode === 'rich' ? editor().getText() : textarea().value).toBe('Hi @Ada and @Alex Cruz ')
  })

  it('a conversation switch without blur never saves the new conversation’s text under the old key', async () => {
    const { editor, render, host } = await mountComposer('draft:old')
    // Rich mode has an unwritten keystroke (no frame yet) and no blur before the switch.
    typeRich(editor(), 'keep me')
    await render('draft:new')
    expect(savedDraft('draft:old')?.body).toBe('keep me')
    // Past the 250 ms autosave: nothing scheduled during the switch writes the (empty) new editor under draft:old.
    await tick(320)
    expect(savedDraft('draft:old')?.body).toBe('keep me')
    expect(savedDraft('draft:new')).toBeNull()
    expect(host.querySelector('.ProseMirror')!.textContent).toBe('')
    typeRich(editor(), 'new text')
    await tick(320)
    expect(savedDraft('draft:new')?.body).toBe('new text')
    expect(savedDraft('draft:old')?.body).toBe('keep me')
  })
})

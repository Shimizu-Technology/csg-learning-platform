// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const editorProps: Array<Record<string, unknown>> = []
vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    editorProps.push(props)
    return null
  },
}))

import { CodeEditor, detectLanguage, indentSizeFor } from './CodeEditor'

describe('CodeEditor indentation', () => {
  it('indents Python with 4 spaces and web languages with 2', () => {
    expect(indentSizeFor('python')).toBe(4)
    expect(indentSizeFor('ruby')).toBe(2)
    expect(indentSizeFor('javascript')).toBe(2)
  })

  it('passes the language indent to Monaco and labels it for learners', () => {
    editorProps.length = 0
    const html = renderToStaticMarkup(<CodeEditor value="" language="python" showKeyboardHelp />)
    const options = editorProps[0].options as Record<string, unknown>
    expect(options.tabSize).toBe(4)
    expect(options.insertSpaces).toBe(true)
    expect(options.detectIndentation).toBe(false)
    expect(html).toContain('Python · Tab = 4 spaces')
    expect(html).toContain('Esc')
    expect(html).toContain('Tab indents')
  })

  it('omits keyboard help for read-only editors', () => {
    const html = renderToStaticMarkup(<CodeEditor value="x" language="python" readOnly showKeyboardHelp />)
    expect(html).not.toContain('Tab indents')
  })

  it('detects pilot filenames', () => {
    expect(detectLanguage('budget_decision.py')).toBe('python')
    expect(detectLanguage('plan.md')).toBe('markdown')
  })
})

describe('CodeEditor keyboard escape', () => {
  function fakeMonaco() {
    const commands: Array<{ keybinding: number; handler: () => void; context?: string }> = []
    const contextKey = { value: false, set(next: boolean) { this.value = next } }
    const editor = {
      createContextKey: () => contextKey,
      addCommand: (keybinding: number, handler: () => void, context?: string) => { commands.push({ keybinding, handler, context }) },
    }
    const monaco = { KeyCode: { Escape: 9, Tab: 2 }, KeyMod: { Shift: 1024 } }
    return { commands, contextKey, editor, monaco }
  }

  it('registers Escape, Tab, and Shift+Tab even for an editor that mounts read-only', async () => {
    editorProps.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<><CodeEditor value="" language="python" readOnly showKeyboardHelp /><button type="button">After editor</button></>) })
    const fake = fakeMonaco()
    ;(editorProps.at(-1)!.onMount as (editor: unknown, monaco: unknown) => void)(fake.editor, fake.monaco)
    expect(fake.commands.map((command) => command.keybinding)).toEqual([9, 2, 1024 | 2])

    // Escape falls back to the next focusable control when no help toggle is visible.
    // jsdom has no layout, so mark the following button as rendered.
    const after = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'After editor')!
    Object.defineProperty(after, 'offsetParent', { configurable: true, get: () => document.body })
    fake.commands[0].handler()
    expect(document.activeElement?.textContent).toBe('After editor')
    act(() => root.unmount())
    container.remove()
  })

  it('toggles Tab-moves-focus through the context key and aria-pressed', async () => {
    editorProps.length = 0
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<CodeEditor value="" language="python" showKeyboardHelp />) })
    const fake = fakeMonaco()
    ;(editorProps.at(-1)!.onMount as (editor: unknown, monaco: unknown) => void)(fake.editor, fake.monaco)
    const toggle = container.querySelector('button[aria-pressed]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { toggle.click() })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(fake.contextKey.value).toBe(true)
    act(() => root.unmount())
    container.remove()
  })
})

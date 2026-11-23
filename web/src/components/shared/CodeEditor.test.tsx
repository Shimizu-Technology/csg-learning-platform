// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { editorProps, loaderState, mediaState, throwOnMonaco } = vi.hoisted(() => ({
  editorProps: [] as Array<Record<string, unknown>>,
  loaderState: {
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'failed',
    ensureMonacoLoaded: vi.fn<() => Promise<unknown>>(),
  },
  mediaState: {
    coarse: false,
    phone: false,
  },
  throwOnMonaco: { active: false },
}))

vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    if (throwOnMonaco.active) throw new Error('Monaco render boom')
    editorProps.push(props)
    return null
  },
}))

vi.mock('../../lib/monacoLoader', () => ({
  MONACO_LOAD_TIMEOUT_MS: 6000,
  PHONE_CODE_EDITOR_QUERY: '(max-width: 639px)',
  getMonacoLoadStatus: () => loaderState.status,
  ensureMonacoLoaded: () => loaderState.ensureMonacoLoaded(),
}))

vi.mock('../../lib/useMediaQuery', () => ({
  useMediaQuery: (query: string) => {
    if (query === '(pointer: coarse)') return mediaState.coarse
    if (query === '(max-width: 639px)') return mediaState.phone
    return false
  },
}))

import { CodeEditor, detectLanguage, indentSizeFor } from './CodeEditor'

beforeEach(() => {
  editorProps.length = 0
  loaderState.status = 'ready'
  loaderState.ensureMonacoLoaded.mockReset()
  loaderState.ensureMonacoLoaded.mockResolvedValue({ editor: {} })
  mediaState.coarse = false
  mediaState.phone = false
  throwOnMonaco.active = false
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('CodeEditor indentation', () => {
  it('indents Python with 4 spaces and web languages with 2', () => {
    expect(indentSizeFor('python')).toBe(4)
    expect(indentSizeFor('ruby')).toBe(2)
    expect(indentSizeFor('javascript')).toBe(2)
  })

  it('passes the language indent to Monaco and labels it for learners', () => {
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

describe('CodeEditor resilience and fallbacks', () => {
  it('falls back to an accessible textarea when Monaco initialization rejects', async () => {
    loaderState.status = 'idle'
    loaderState.ensureMonacoLoaded.mockRejectedValueOnce(new Error('CDN blocked'))

    function Controlled() {
      const [code, setCode] = useState('initial = 1')
      return <CodeEditor ariaLabel="Your code" value={code} onChange={setCode} language="python" wordWrap="off" showKeyboardHelp />
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<Controlled />) })

    const textarea = container.querySelector('textarea[aria-label="Your code"]') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('initial = 1')
    expect(textarea.getAttribute('wrap')).toBe('off')
    expect(container.textContent).toContain('Using the basic code editor')
    expect(editorProps).toHaveLength(0)

    act(() => root.unmount())
    container.remove()
  })

  it('recovers from a stalled load after the timeout and prevents late Monaco takeover', async () => {
    vi.useFakeTimers()
    loaderState.status = 'idle'
    let resolveLate!: (value: unknown) => void
    loaderState.ensureMonacoLoaded.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve }))

    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<CodeEditor ariaLabel="Your code" value="" onChange={onChange} language="python" loadTimeoutMs={500} />) })

    expect(container.textContent).toContain('Loading code editor')
    expect(container.querySelector('textarea')).toBeNull()

    await act(async () => { vi.advanceTimersByTime(500) })

    const textarea = container.querySelector('textarea[aria-label="Your code"]') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(editorProps).toHaveLength(0)

    // Even if the stalled CDN finishes later while the student is typing, Monaco must not take over.
    await act(async () => {
      resolveLate({ editor: {} })
      await Promise.resolve()
    })

    expect(container.querySelector('textarea[aria-label="Your code"]')).toBe(textarea)
    expect(editorProps).toHaveLength(0)

    act(() => root.unmount())
    container.remove()
  })

  it('uses the textarea immediately without loading Monaco on coarse pointer or phone viewports', async () => {
    loaderState.status = 'idle'
    mediaState.coarse = true

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<CodeEditor ariaLabel="Solution code" value="puts 1" language="ruby" />) })

    expect(container.querySelector('textarea[aria-label="Solution code"]')).not.toBeNull()
    expect(loaderState.ensureMonacoLoaded).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Using the basic code editor')

    mediaState.coarse = false
    mediaState.phone = true
    await act(async () => { root.render(<CodeEditor ariaLabel="Solution code" value="puts 2" language="ruby" />) })
    expect(container.querySelector('textarea[aria-label="Solution code"]')).not.toBeNull()
    expect(loaderState.ensureMonacoLoaded).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })

  it('respects readOnly and busy on the fallback textarea', () => {
    loaderState.status = 'failed'
    const readOnlyHtml = renderToStaticMarkup(<CodeEditor ariaLabel="Your code" value="x = 1" readOnly />)
    expect(readOnlyHtml).toContain('readOnly=""')
    const busyHtml = renderToStaticMarkup(<CodeEditor ariaLabel="Your code" value="x = 1" busy />)
    expect(busyHtml).toContain('disabled=""')
  })

  it('supports Tab indentation and Escape focus exit on the fallback textarea', async () => {
    loaderState.status = 'failed'
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <>
          <CodeEditor ariaLabel="Your code" value="def f():" onChange={onChange} language="python" showKeyboardHelp />
          <button type="button">After fallback</button>
        </>,
      )
    })

    const textarea = container.querySelector('textarea[aria-label="Your code"]') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(8, 8)
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(onChange).toHaveBeenCalledWith('def f():    ')

    const toggle = container.querySelector('button[aria-pressed]') as HTMLButtonElement
    Object.defineProperty(toggle, 'offsetParent', { configurable: true, get: () => document.body })
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(toggle)

    act(() => root.unmount())
    container.remove()
  })

  it('catches a synchronous Monaco render failure and falls back to textarea', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    throwOnMonaco.active = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<CodeEditor ariaLabel="Your code" value="x = 1" language="python" />) })

    expect(container.querySelector('textarea[aria-label="Your code"]')).not.toBeNull()
    expect(container.textContent).toContain('Using the basic code editor')

    act(() => root.unmount())
    container.remove()
    consoleError.mockRestore()
  })
})

it('preserves Off wrapping while the redesigned lesson uses unwrapped Monaco source', () => {
  renderToStaticMarkup(<CodeEditor value="very_long_python_identifier = 'source'" wordWrap="off" />)
  expect((editorProps[0].options as Record<string, unknown>).wordWrap).toBe('off')
  renderToStaticMarkup(<CodeEditor value="old experience" />)
  expect((editorProps[1].options as Record<string, unknown>).wordWrap).toBe('on')
})

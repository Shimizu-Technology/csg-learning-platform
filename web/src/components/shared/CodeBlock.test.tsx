// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  observed: Element[] = []
  disconnected = false
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element) { this.observed.push(element) }
  disconnect() { this.disconnected = true }
  unobserve() {}
  takeRecords() { return [] }
  intersect(isIntersecting: boolean) {
    this.callback(this.observed.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry), this as unknown as IntersectionObserver)
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(element))
  return container
}

/** Lets the dynamic import of the highlighter resolve and its state update land. */
async function settle() {
  for (let attempt = 0; attempt < 20 && !container?.querySelector('code.hljs'); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  FakeIntersectionObserver.instances = []
  vi.unstubAllGlobals()
})

describe('CodeBlock highlighting', () => {
  it('loads the highlighter only once a labeled block comes near the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const view = await render(<CodeBlock code={'puts "hi"'} language="ruby" />)

    const [observer] = FakeIntersectionObserver.instances
    expect(observer.options).toEqual({ rootMargin: '100% 0px' })
    expect(observer.observed).toEqual([view.querySelector('.code-block')])
    expect(view.querySelector('code.hljs')).toBeNull()

    await act(async () => observer.intersect(false))
    await settle()
    expect(view.querySelector('code.hljs')).toBeNull()

    await act(async () => observer.intersect(true))
    await settle()
    const code = view.querySelector('code.hljs')!
    expect(code.className).toContain('language-ruby')
    expect(code.textContent).toBe('puts "hi"')
    expect(code.querySelector('span[class^="hljs-"]')).not.toBeNull()
    // Once highlighted it stops watching.
    expect(observer.disconnected).toBe(true)
  })

  it('never observes or highlights an unlabeled block', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const view = await render(<CodeBlock code="ls -a" />)
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
    expect(view.querySelector('code')!.className).toBe('')
  })

  it('stops observing when the block unmounts before it is seen', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    await render(<CodeBlock code="x = 1" language="python" />)
    const [observer] = FakeIntersectionObserver.instances
    act(() => root!.unmount())
    root = null
    expect(observer.disconnected).toBe(true)
  })

  it('highlights straight away where IntersectionObserver is missing', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const view = await render(<CodeBlock code="const a = 1" language="js" />)
    await settle()
    expect(view.querySelector('code.hljs')?.className).toContain('language-javascript')
  })
})

describe('CodeBlock copy and accessibility', () => {
  it('bounds submitted code so grading controls stay in reach, but not lesson code', async () => {
    const long = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join('\n')
    const submission = await render(<CodeBlock code={long} surface="submission" lineNumbers />)
    expect(submission.querySelector('[role="region"]')?.className).toContain('max-h-[min(70vh,40rem)]')
    expect(submission.querySelector('[role="region"]')?.className).toContain('overflow-y-auto')
    const lesson = await render(<CodeBlock code={long} />)
    expect(lesson.querySelector('pre')?.className).not.toContain('max-h-')
  })

  function stubClipboard(result: 'ok' | 'fail') {
    const writeText = vi.fn(() => (result === 'ok' ? Promise.resolve() : Promise.reject(new Error('denied'))))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    // The legacy fallback fails too, so "fail" really fails.
    document.execCommand = vi.fn(() => false)
    return writeText
  }

  it('labels the block, copies the trimmed code and announces "Copied"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const writeText = stubClipboard('ok')
    const view = await render(<CodeBlock code={'\n\nconst a = 1\nconsole.log(a)\n\n'} language="js" />)
    expect(view.querySelector('.code-block span')?.textContent).toBe('JavaScript')
    const pre = view.querySelector('pre')!
    expect(pre.getAttribute('aria-label')).toBe('JavaScript code')
    // Keyboard users can reach the block to scroll long lines.
    expect(pre.tabIndex).toBe(0)
    const button = view.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('Copy code')
    expect(view.querySelector('[aria-live="polite"]')?.textContent).toBe('')

    await act(async () => { button.click() })
    expect(writeText).toHaveBeenCalledWith('const a = 1\nconsole.log(a)')
    expect(button.dataset.state).toBe('copied')
    expect(button.textContent).toContain('Copied')
    expect(view.querySelector('[aria-live="polite"]')?.textContent).toBe('Copied')

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(button.dataset.state).toBe('idle')
    expect(button.getAttribute('aria-label')).toBe('Copy code')
    vi.useRealTimers()
  })

  it('says how to recover when copying fails', async () => {
    stubClipboard('fail')
    const view = await render(<CodeBlock code="x = 1" language="python" />)
    const button = view.querySelector('button')!
    await act(async () => { button.click() })
    expect(button.dataset.state).toBe('failed')
    expect(button.textContent).toBe('Copy failed — select the code instead')
  })

  it('scrolls long lines instead of wrapping, so phones never wrap mid-token', async () => {
    const view = await render(<CodeBlock code={'x'.repeat(400)} language="ruby" />)
    const pre = view.querySelector('pre')!
    expect(pre.className).toContain('whitespace-pre')
    expect(pre.className).toContain('overflow-x-auto')
    expect(pre.className).not.toMatch(/whitespace-pre-wrap|break-/)
  })

  it('shows line numbers that are hidden from screen readers and never copied', async () => {
    const writeText = stubClipboard('ok')
    const view = await render(<CodeBlock code={'a = 1\nb = 2\nc = 3'} language="ruby" lineNumbers surface="submission" label="solution.rb" />)
    const gutter = view.querySelector('[data-line-numbers]')!
    expect(gutter.getAttribute('aria-hidden')).toBe('true')
    expect(gutter.className).toContain('select-none')
    expect(gutter.textContent).toBe('1\n2\n3')
    const region = view.querySelector('[role="region"]')!
    expect(region.getAttribute('aria-label')).toBe('solution.rb code')
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(view.querySelector('.code-block span')?.textContent).toBe('solution.rb')
    await act(async () => { view.querySelector('button')!.click() })
    expect(writeText).toHaveBeenCalledWith('a = 1\nb = 2\nc = 3')
  })

  it('renders code as text, never as HTML', async () => {
    const view = await render(<CodeBlock code={'<img src=x onerror="alert(1)"><script>alert(2)</script>'} />)
    expect(view.querySelector('img, script')).toBeNull()
    expect(view.querySelector('code')?.textContent).toContain('<script>')
  })

  it('lets only class-named spans through from the highlighter', async () => {
    vi.doMock('../../lib/highlight', () => ({ highlightCode: () => '<span class="hljs-keyword">def</span><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>' }))
    vi.resetModules()
    const { CodeBlock: FreshCodeBlock } = await import('./CodeBlock')
    const view = await render(<FreshCodeBlock code="def x" language="ruby" />)
    await settle()
    const code = view.querySelector('code.hljs')!
    expect(code.querySelector('span.hljs-keyword')?.textContent).toBe('def')
    expect(code.querySelector('img, a, [onerror]')).toBeNull()
    vi.doUnmock('../../lib/highlight')
  })
})

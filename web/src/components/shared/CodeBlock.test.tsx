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

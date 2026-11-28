// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Collapse, TabList, TabPanel } from './Motion'
import { TabButton } from './Choice'
import { pageKey, prefersReducedMotion, useInsertedKeys, usePageFade } from '../../lib/motion'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(element))
  return container
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

function Toggle({ keepMounted = false, initial = false }: { keepMounted?: boolean; initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return <>
    <button type="button" onClick={() => setOpen((value) => !value)}>Toggle</button>
    <Collapse open={open} keepMounted={keepMounted}><a href="#x">Inside</a></Collapse>
  </>
}

describe('Collapse', () => {
  it('opens and closes instantly under reduced motion', async () => {
    stubReducedMotion(true)
    const view = await render(<Toggle />)
    expect(view.textContent).not.toContain('Inside')
    await act(async () => view.querySelector('button')!.click())
    const panel = view.querySelector('.motion-collapse')!
    expect(panel.getAttribute('data-state')).toBe('open')
    expect(panel.getAttribute('data-expanded')).toBe('true')
    await act(async () => view.querySelector('button')!.click())
    expect(view.querySelector('.motion-collapse')).toBeNull()
  })

  it('animates grid rows open, then keeps closing content inert until it unmounts', async () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const view = await render(<Toggle />)
    await act(async () => view.querySelector('button')!.click())
    const panel = view.querySelector('.motion-collapse')!
    expect(panel.getAttribute('data-state')).toBe('opening')
    // Starts at 0fr; the expanded attribute arrives on a later frame.
    expect(panel.getAttribute('data-expanded')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(panel.getAttribute('data-state')).toBe('open')
    expect(panel.getAttribute('data-expanded')).toBe('true')

    await act(async () => view.querySelector('button')!.click())
    expect(panel.getAttribute('data-state')).toBe('closing')
    expect(panel.hasAttribute('inert')).toBe(true)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(view.querySelector('.motion-collapse')).toBeNull()
  })

  it('keeps closed content hidden (out of the tab order) with keepMounted', async () => {
    stubReducedMotion(true)
    const view = await render(<Toggle keepMounted />)
    const panel = view.querySelector('.motion-collapse') as HTMLElement
    expect(panel.hidden).toBe(true)
    await act(async () => view.querySelector('button')!.click())
    expect(panel.hidden).toBe(false)
  })

  it('renders content that starts open without animating', async () => {
    stubReducedMotion(false)
    const view = await render(<Toggle initial />)
    expect(view.querySelector('.motion-collapse')?.getAttribute('data-state')).toBe('open')
  })
})

describe('TabList', () => {
  function Tabs() {
    const [tab, setTab] = useState('a')
    return <>
      <TabList label="Sections">
        <TabButton asTab selected={tab === 'a'} onClick={() => setTab('a')}>A</TabButton>
        <TabButton asTab selected={tab === 'b'} onClick={() => setTab('b')}>B</TabButton>
      </TabList>
      <TabPanel key={tab} aria-label={tab}>{tab}</TabPanel>
    </>
  }

  it('is a labelled tablist whose indicator slides between tabs, but not on first placement', async () => {
    stubReducedMotion(false)
    const view = await render(<Tabs />)
    const list = view.querySelector('[role="tablist"]')!
    expect(list.getAttribute('aria-label')).toBe('Sections')
    const indicator = view.querySelector('.tab-indicator') as HTMLElement
    expect(indicator.getAttribute('aria-hidden')).toBe('true')
    expect(indicator.dataset.animate).toBe('false')
    await act(async () => (view.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click())
    expect(indicator.dataset.animate).toBe('true')
    expect(view.querySelector('[role="tabpanel"]')?.className).toContain('motion-tab-panel')
  })

  it('jumps under reduced motion', async () => {
    stubReducedMotion(true)
    const view = await render(<Tabs />)
    await act(async () => (view.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click())
    expect((view.querySelector('.tab-indicator') as HTMLElement).dataset.animate).toBe('false')
  })

  it('shows left/right scroll buttons when a scrollable TabList overflows and supports arrow keys', async () => {
    stubReducedMotion(true)
    function WeekTabs() {
      const [week, setWeek] = useState(1)
      return (
        <TabList scrollable label="Live Class weeks" className="flex">
          {[1, 2, 3, 4].map((w) => (
            <TabButton key={w} asTab selected={week === w} onClick={() => setWeek(w)}>Week {w}</TabButton>
          ))}
        </TabList>
      )
    }
    const view = await render(<WeekTabs />)
    const list = view.querySelector<HTMLDivElement>('[role="tablist"]')!
    let scrollLeft = 0
    Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(list, 'scrollWidth', { configurable: true, get: () => 600 })
    Object.defineProperty(list, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v: number) => { scrollLeft = v } })
    await act(async () => { list.dispatchEvent(new Event('scroll')) })

    const leftBtn = view.querySelector<HTMLButtonElement>('button[aria-label="Scroll Live Class weeks left"]')!
    const rightBtn = view.querySelector<HTMLButtonElement>('button[aria-label="Scroll Live Class weeks right"]')!
    expect(leftBtn.disabled).toBe(true)
    expect(rightBtn.disabled).toBe(false)

    await act(async () => { rightBtn.click() })
    expect(scrollLeft).toBeGreaterThan(0)
    expect(leftBtn.disabled).toBe(false)

    const tabs = view.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs[0].focus()
    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  })
})

describe('page fade', () => {
  function Page({ path }: { path: string }) {
    const ref = useRef<HTMLElement>(null)
    usePageFade(ref, path)
    return <main ref={ref}>page</main>
  }

  it('fades the page in on a page change only: not for filters or switching conversations', async () => {
    stubReducedMotion(false)
    const animate = vi.fn(() => ({ cancel() {} }))
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
    const view = await render(<Page path="/admin/grading" />)
    expect(animate).not.toHaveBeenCalled()
    await act(async () => root!.render(<Page path="/admin/support" />))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0]).toEqual([[{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }])
    await act(async () => root!.render(<Page path="/messages/dm/3" />))
    await act(async () => root!.render(<Page path="/messages/dm/4" />))
    expect(animate).toHaveBeenCalledTimes(2)
    expect(view.textContent).toBe('page')
  })

  it('does nothing under reduced motion', async () => {
    stubReducedMotion(true)
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
    await render(<Page path="/admin/grading" />)
    await act(async () => root!.render(<Page path="/admin/support" />))
    expect(animate).not.toHaveBeenCalled()
  })

  it('names pages by their first two path segments', () => {
    expect(pageKey('/admin/grading')).toBe('admin/grading')
    expect(pageKey('/messages/dm/3')).toBe('messages/dm')
    expect(pageKey('/')).toBe('')
  })

  it('treats a browser without matchMedia as reduced motion', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(true)
  })
})

describe('list insert', () => {
  function List({ ids, loading = false }: { ids: number[]; loading?: boolean }) {
    const inserted = useInsertedKeys(ids, { ready: !loading })
    return <ul>{ids.map((id) => <li key={id} className={inserted.has(id) ? 'motion-insert' : ''}>{id}</li>)}</ul>
  }

  it('animates only rows added after the list loaded, never a reload', async () => {
    const view = await render(<List ids={[1, 2]} />)
    expect(view.querySelectorAll('.motion-insert')).toHaveLength(0)
    await act(async () => root!.render(<List ids={[3, 1, 2]} />))
    expect(Array.from(view.querySelectorAll('.motion-insert'), (row) => row.textContent)).toEqual(['3'])
    await act(async () => root!.render(<List ids={[3, 1, 2]} loading />))
    await act(async () => root!.render(<List ids={[7, 8]} />))
    expect(view.querySelectorAll('.motion-insert')).toHaveLength(0)
  })
})

describe('motion CSS', () => {
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n')

  it('turns every motion in the set off under reduced motion', () => {
    expect(reduced).toMatch(/\.motion-collapse\.motion-collapse,\s*\.tab-indicator\.tab-indicator\s*\{\s*transition: none !important;/)
    expect(reduced).toMatch(/details\[open\] > :not\(summary\),\s*\.motion-tab-panel\.motion-tab-panel,\s*\.motion-insert\.motion-insert\s*\{\s*animation: none !important;/)
  })

  it('uses the duration and easing tokens', () => {
    expect(css).toMatch(/\.motion-collapse \{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
    expect(css).toMatch(/\.motion-collapse \{[^}]*transition: grid-template-rows var\(--duration-accordion\) var\(--ease-out\)/)
    expect(css).toMatch(/\.motion-collapse-body \{[^}]*min-width: 0;/)
    expect(css).toMatch(/\.motion-tab-panel \{\s*animation: tab-panel-enter var\(--duration-tab\) var\(--ease-out\)/)
    expect(css).toMatch(/\.motion-insert \{\s*animation: list-insert var\(--duration-accordion\) var\(--ease-out\)/)
    expect(css).toMatch(/--duration-accordion:\s*200ms/)
    expect(css).toMatch(/--duration-tab:\s*160ms/)
    expect(css).toMatch(/--duration-indicator:\s*220ms/)
  })

  it('animates only transform and opacity in the new keyframes', () => {
    for (const name of ['disclosure-reveal', 'tab-panel-enter', 'list-insert']) {
      const body = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || ''
      const properties = [...body.matchAll(/([a-z-]+):/g)].map((match) => match[1])
      expect(properties.length, name).toBeGreaterThan(0)
      expect(properties.every((property) => property === 'opacity' || property === 'transform'), name).toBe(true)
    }
  })
})

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { StarterLinkContext } from './HafaStarterLink'

const STARTER = 'https://code.shimizu-technology.com/?lang=python#project=z.FcxBCsIw&starter=csg-python-pilot%3Aorientation'
const CONTEXT: StarterLinkContext = {
  lessonReturn: { url: 'https://learn.codeschoolofguam.com/lessons/419?cohort_id=5#block-901', label: 'Orientation — your first run' },
  hint: 'submit',
}

// Flush effects inside act() so rich-text links are decorated before assertions.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

function mockTouch(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse') ? matches : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

async function render(content: string, starterLinks?: StarterLinkContext) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<MarkdownRenderer content={content} starterLinks={starterLinks} />) })
  return container
}

function hashParams(href: string | null) {
  return new URLSearchParams(new URL(href!).hash.slice(1))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Hafa Code starter links in lesson content', () => {
  it('renders a markdown starter link as a button that returns to the lesson, in a new tab on desktop', async () => {
    mockTouch(false)
    const container = await render(`Start here.\n\n[Open starter in Hafa Code](${STARTER})\n\nThen read on.`, CONTEXT)
    const link = container.querySelector('a')!
    expect(link.textContent).toBe('Open starter in Hafa Code (opens in a new tab)')
    expect(link.className).toContain('hafa-starter-link')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    const params = hashParams(link.getAttribute('href'))
    expect(params.get('project')).toBe('z.FcxBCsIw')
    expect(params.get('return')).toBe(CONTEXT.lessonReturn.url)
    expect(params.get('returnLabel')).toBe('Orientation — your first run')
    const hint = document.getElementById(link.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('Run it there, then use Copy code for Learn and paste it here.')
  })

  it('opens in the same tab on touch devices and uses the practice hint without a submission box', async () => {
    mockTouch(true)
    const container = await render(`[Open starter in Hafa Code](${STARTER})`, { ...CONTEXT, hint: 'practice' })
    const link = container.querySelector('a')!
    expect(link.hasAttribute('target')).toBe(false)
    expect(link.textContent).toBe('Open starter in Hafa Code')
    expect(container.textContent).toContain('Run it there and try a change. Back to your lesson brings you here.')
  })

  it('opens a new tab on touch devices when the context asks for one', async () => {
    mockTouch(true)
    const container = await render(`[Open starter in Hafa Code](${STARTER})`, { ...CONTEXT, newTab: true })
    expect(container.querySelector('a')!.getAttribute('target')).toBe('_blank')
  })

  it('keeps an existing return, leaves other links alone, and never renders javascript: links', async () => {
    mockTouch(false)
    const withReturn = `${STARTER}&return=https%3A%2F%2Flearn.codeschoolofguam.com%2Flessons%2F7`
    const container = await render(`[Starter](${withReturn}) [Docs](https://example.com/docs#project=1) [Home](https://code.shimizu-technology.com/) [Bad](javascript:alert(1))`, CONTEXT)
    const links = Array.from(container.querySelectorAll('a'))
    expect(links[0].getAttribute('href')).toBe(withReturn)
    expect(links[0].className).toContain('hafa-starter-link')
    expect(links[1].getAttribute('href')).toBe('https://example.com/docs#project=1')
    expect(links[1].className).toBe('')
    expect(links[2].getAttribute('href')).toBe('https://code.shimizu-technology.com/')
    expect(links[2].className).toBe('')
    expect(links[3].getAttribute('href') ?? '').not.toContain('javascript')
    expect(links[3].className).toBe('')
  })

  it('renders starter links as plain links outside a lesson', async () => {
    mockTouch(false)
    const container = await render(`[Open starter in Hafa Code](${STARTER})`)
    const link = container.querySelector('a')!
    expect(link.getAttribute('href')).toBe(STARTER)
    expect(link.className).toBe('')
    expect(container.querySelector('.hafa-starter-hint')).toBeNull()
  })

  it('decorates starter links in rich-text (HTML) bodies once and strips unsafe links', async () => {
    mockTouch(false)
    const html = `<p>Start here.</p><p><a href="${STARTER.replace(/&/g, '&amp;')}">Open starter in Hafa Code</a></p><p><a href="javascript:alert(1)">Bad</a> <a href="https://example.com">Other</a></p>`
    const container = await render(html, CONTEXT)
    await act(async () => { root!.render(<MarkdownRenderer content={html} starterLinks={{ ...CONTEXT }} />) })
    const [starter, bad, other] = Array.from(container.querySelectorAll('a'))
    expect(starter.className).toContain('hafa-starter-link')
    expect(starter.getAttribute('target')).toBe('_blank')
    expect(hashParams(starter.getAttribute('href')).get('return')).toBe(CONTEXT.lessonReturn.url)
    expect(starter.getAttribute('href')!.match(/return=/g)).toHaveLength(1)
    expect(container.querySelectorAll('.hafa-starter-hint')).toHaveLength(1)
    expect(document.getElementById(starter.getAttribute('aria-describedby')!)?.textContent).toBe('Run it there, then use Copy code for Learn and paste it here.')
    expect(bad.getAttribute('href')).toBeNull()
    expect(other.getAttribute('href')).toBe('https://example.com')
    expect(other.className).toBe('')
  })

  it('updates rich-text starter links when the lesson context changes and restores them without it', async () => {
    mockTouch(false)
    const html = `<p><a href="${STARTER.replace(/&/g, '&amp;')}">Open starter in Hafa Code</a></p>`
    const container = await render(html, CONTEXT)
    await act(async () => { root!.render(<MarkdownRenderer content={html} starterLinks={{ ...CONTEXT, lessonReturn: { ...CONTEXT.lessonReturn, label: 'Renamed lesson' } }} />) })
    let link = container.querySelector('a')!
    expect(hashParams(link.getAttribute('href')).get('returnLabel')).toBe('Renamed lesson')
    expect(link.getAttribute('href')!.match(/return=/g)).toHaveLength(1)
    expect(link.textContent).toBe('Open starter in Hafa Code (opens in a new tab)')
    expect(container.querySelectorAll('.hafa-starter-hint')).toHaveLength(1)

    await act(async () => { root!.render(<MarkdownRenderer content={html} />) })
    link = container.querySelector('a')!
    expect(link.getAttribute('href')).toBe(STARTER)
    expect(link.className).toBe('')
    expect(container.querySelector('.hafa-starter-hint')).toBeNull()
  })
})

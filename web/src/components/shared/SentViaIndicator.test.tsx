// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SentViaIndicator } from './SentViaIndicator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

it('shows a quiet icon label with the token name', () => {
  act(() => root.render(<SentViaIndicator label="Home base" />))
  expect(container.textContent).toBe('Sent via Home base')
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('span')?.getAttribute('title')).toContain('Home base')
})

it.each([null, undefined, '', '   '])('renders nothing for %j', (label) => {
  act(() => root.render(<SentViaIndicator label={label} />))
  expect(container.innerHTML).toBe('')
})

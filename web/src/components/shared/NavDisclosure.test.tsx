// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { NavDisclosure } from './NavDisclosure'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it.each(['More', 'Admin'])('%s opens, traverses links and restores focus on Escape', async label => {
  const div = document.createElement('div'); document.body.append(div)
  const root = createRoot(div)
  await act(async () => root.render(<NavDisclosure label={label}>{[<a key="a" href="/a">First</a>, <a key="b" href="/b">Second</a>]}</NavDisclosure>))
  const button = div.querySelector('button')!
  expect(button.getAttribute('aria-expanded')).toBe('false')
  await act(async () => button.click())
  expect(button.getAttribute('aria-expanded')).toBe('true')
  await act(async () => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)) })
  expect(document.activeElement?.textContent).toBe('First')
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)) })
  expect(document.activeElement?.textContent).toBe('Second')
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(button)
  await act(async () => root.unmount()); div.remove()
})

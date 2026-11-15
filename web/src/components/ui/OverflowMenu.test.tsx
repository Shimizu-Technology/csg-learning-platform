// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OverflowMenu } from './OverflowMenu'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
const key = (target: Element, name: string) => act(async () => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
})

it('returns focus to the ⋯ button before running a keyboard-chosen action', async () => {
  let focusedDuringSelect: Element | null = null
  const onSelect = vi.fn(() => { focusedDuringSelect = document.activeElement })
  await act(async () => root.render(
    <MemoryRouter>
      <OverflowMenu label="Conversation options" items={[
        { key: 'mute', label: 'Mute', onSelect: vi.fn() },
        { key: 'copy', label: 'Copy link', onSelect },
      ]} />
    </MemoryRouter>,
  ))
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Conversation options"]')!
  trigger.focus()
  await act(async () => trigger.click())
  await tick()
  const items = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  expect(document.activeElement).toBe(items()[0])

  await key(document.activeElement!, 'ArrowDown')
  expect(document.activeElement?.textContent).toBe('Copy link')
  // Enter on a focused button activates it.
  await act(async () => (document.activeElement as HTMLButtonElement).click())

  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(focusedDuringSelect).toBe(trigger)
  expect(container.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('lets an action move focus on, such as into a dialog it opens', async () => {
  const dialogButton = document.createElement('button')
  document.body.appendChild(dialogButton)
  await act(async () => root.render(
    <MemoryRouter>
      <OverflowMenu label="Options" items={[{ key: 'open', label: 'Open dialog', onSelect: () => dialogButton.focus() }]} />
    </MemoryRouter>,
  ))
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Options"]')!
  await act(async () => trigger.click())
  await tick()
  await act(async () => container.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(document.activeElement).toBe(dialogButton)
  dialogButton.remove()
})

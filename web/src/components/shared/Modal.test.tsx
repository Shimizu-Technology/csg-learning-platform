// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

/** Mirrors ConfirmContext: the dialog's content is cleared in the same update that closes it. */
function Harness() {
  const [options, setOptions] = useState<{ title: string; body: string } | null>({ title: 'Delete this time?', body: 'Students will no longer see it.' })
  return (
    <>
      <button type="button" id="opener" onClick={() => setOptions({ title: 'Delete this time?', body: 'Students will no longer see it.' })}>Open</button>
      <Modal open={Boolean(options)} onClose={() => setOptions(null)} title={options?.title || 'Confirm action'} subtitle={options?.body}>
        <p>{options?.body || 'nothing'}</p>
      </Modal>
    </>
  )
}

describe('Modal close animation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
    vi.useRealTimers()
  })

  it('animates a frozen copy of the last open frame, never the cleared content', () => {
    act(() => root.render(<Harness />))
    act(() => vi.runOnlyPendingTimers())
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close Delete this time?"]')!
    act(() => close.click())

    // The live dialog is gone at once, so focus and stacking logic only see real dialogs.
    expect(document.querySelectorAll('[data-app-modal]')).toHaveLength(0)
    const ghost = document.querySelector<HTMLElement>('.app-modal-overlay[data-state="closing"]')!
    expect(ghost).not.toBeNull()
    expect(ghost.textContent).toContain('Delete this time?')
    expect(ghost.textContent).toContain('Students will no longer see it.')
    expect(ghost.textContent).not.toContain('Confirm action')
    expect(ghost.textContent).not.toContain('nothing')
    // Not interactive or announced, and no duplicate ids.
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.querySelector('[role="dialog"]')).toBeNull()
    expect(ghost.querySelector('[id]')).toBeNull()

    act(() => vi.advanceTimersByTime(400))
    expect(document.querySelector('[data-state="closing"]')).toBeNull()
  })

  it('removes the copy as soon as its own animation ends', () => {
    act(() => root.render(<Harness />))
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close Delete this time?"]')!.click())
    const ghost = document.querySelector<HTMLElement>('[data-state="closing"]')!
    // A child's animation ending must not remove it early.
    act(() => ghost.firstElementChild!.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(ghost.isConnected).toBe(true)
    act(() => ghost.dispatchEvent(new Event('animationend')))
    expect(ghost.isConnected).toBe(false)
  })

  it('returns focus to the opener when it closes', () => {
    act(() => root.render(<Harness />))
    const opener = document.getElementById('opener') as HTMLButtonElement
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close Delete this time?"]')!.click())
    act(() => opener.focus())
    act(() => opener.click())
    act(() => vi.runOnlyPendingTimers())
    act(() => document.querySelector<HTMLButtonElement>('[data-app-modal] [aria-label="Close Delete this time?"]')!.click())
    expect(document.activeElement).toBe(opener)
  })
})

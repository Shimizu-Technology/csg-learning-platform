// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMessageLongPress } from './useMessageLongPress'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const open = vi.fn()
function Harness() { return <div data-row {...useMessageLongPress(open)}><p>Selectable message</p><a href="#link">Link</a><button>More</button></div> }
beforeEach(() => { vi.useFakeTimers(); open.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<Harness />)) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })
function pointer(type: string, target: Element = host.querySelector('p')!, extra: Record<string, unknown> = {}) { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 20, clientY: 20 }, extra); act(() => target.dispatchEvent(event)); return event }
it('opens after a stationary touch hold without preventing browser defaults', () => {
  expect(pointer('pointerdown').defaultPrevented).toBe(false)
  act(() => vi.advanceTimersByTime(500))
  expect(open).toHaveBeenCalledTimes(1)
})
it.each(['pointerup', 'pointercancel', 'pointerout'])('cancels on %s', (type) => { pointer('pointerdown'); pointer(type); act(() => vi.advanceTimersByTime(600)); expect(open).not.toHaveBeenCalled() })
it.each(['scroll'])('cancels on %s', (type) => { pointer('pointerdown'); act(() => document.dispatchEvent(new Event(type))); act(() => vi.advanceTimersByTime(600)); expect(open).not.toHaveBeenCalled() })
it('cancels movement and ignores links, controls, mouse, and secondary touches', () => {
  pointer('pointerdown'); pointer('pointermove', undefined, { clientY: 40 }); act(() => vi.advanceTimersByTime(600));
  pointer('pointerdown', host.querySelector('a')!); act(() => vi.advanceTimersByTime(600));
  pointer('pointerdown', host.querySelector('button')!); act(() => vi.advanceTimersByTime(600));
  pointer('pointerdown', undefined, { pointerType: 'mouse' }); act(() => vi.advanceTimersByTime(600));
  pointer('pointerdown', undefined, { isPrimary: false }); act(() => vi.advanceTimersByTime(600));
  expect(open).not.toHaveBeenCalled()
})
it('does not replace an existing text selection or survive unmount', () => {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Selected message' } as Selection)
  pointer('pointerdown'); act(() => vi.advanceTimersByTime(600)); expect(open).not.toHaveBeenCalled()
  vi.restoreAllMocks(); pointer('pointerdown'); act(() => root.unmount()); root = createRoot(host); act(() => vi.advanceTimersByTime(600)); expect(open).not.toHaveBeenCalled()
})

it('lets collapsed selection changes coexist with a hold, and cancels once text is selected', () => {
  pointer('pointerdown'); act(() => document.dispatchEvent(new Event('selectionchange'))); act(() => vi.advanceTimersByTime(500)); expect(open).toHaveBeenCalledTimes(1)
  open.mockClear(); pointer('pointerdown');
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Selected' } as Selection)
  act(() => document.dispatchEvent(new Event('selectionchange'))); act(() => vi.advanceTimersByTime(500)); expect(open).not.toHaveBeenCalled()
})

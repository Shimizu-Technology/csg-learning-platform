import { useLayoutEffect, useRef } from 'react'

/*
 * Keys held down right now, for single-key shortcuts that change what is on screen
 * (the review's A/B/C/R grades and J/K steps). A shortcut that opens the next review
 * must not fire again there from the same press: browsers auto-repeat a held key, and
 * the repeats land on the new review. useFreshKeyGate drops repeats and any key that
 * was already down when the review changed, until that key comes back up.
 */

const held = new Set<string>()
let listening = false

const keyName = (key: string) => key.toUpperCase()

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', (event) => held.add(keyName(event.key)), true)
  window.addEventListener('keyup', (event) => held.delete(keyName(event.key)), true)
  // A key released while the window was in the background never sends keyup.
  window.addEventListener('blur', () => held.clear())
}

/**
 * Returns `fresh(event)`: true for a new press of a key, false for an auto-repeat or for
 * a key that was already held when `scope` (the review's id) last changed.
 */
export function useFreshKeyGate(scope: unknown) {
  const stale = useRef<Set<string>>(new Set())
  listen()
  useLayoutEffect(() => {
    stale.current = new Set(held)
    const release = (event: KeyboardEvent) => stale.current.delete(keyName(event.key))
    const reset = () => stale.current.clear()
    window.addEventListener('keyup', release, true)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keyup', release, true)
      window.removeEventListener('blur', reset)
    }
  }, [scope])
  return (event: { key: string; repeat: boolean }) => !event.repeat && !stale.current.has(keyName(event.key))
}

/** Test helper: forget every held key. */
export function resetHeldKeys() {
  held.clear()
}

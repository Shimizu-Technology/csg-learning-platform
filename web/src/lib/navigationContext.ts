import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { activityReturnPath, safeInternalReturnPath } from './routes'

/*
 * Navigation context for list → record → back. A list hands its exact URL
 * (filters, search, sort, selection) and a label to the record through router
 * state; the record shows "Back to <label>" and returns there with
 * `restoreList`, and the list restores its scroll position (saved in this
 * tab's sessionStorage) once its rows have loaded. Browser Back (POP)
 * restores the same way.
 */

export interface ReturnContext {
  returnTo: string
  returnLabel: string
}

interface ReturnState {
  returnTo?: unknown
  returnLabel?: unknown
  restoreList?: unknown
}

const RETURN_PREFIX = 'csg:return:'
const SCROLL_PREFIX = 'csg:list-scroll:'

/** Router state for a link from a list to one of its records. */
export function listLinkState(location: { pathname: string; search: string }, returnLabel: string): ReturnContext {
  return { returnTo: `${location.pathname}${location.search}`, returnLabel }
}

/** Router state for returning to a list; the list restores its scroll position. */
export const RESTORE_LIST_STATE = Object.freeze({ restoreList: true })

/** Reads a validated return context from router state, or null. */
export function readReturnContext(state: unknown): ReturnContext | null {
  if (!state || typeof state !== 'object') return null
  const { returnTo, returnLabel } = state as ReturnState
  if (typeof returnTo !== 'string' || typeof returnLabel !== 'string' || !returnLabel.trim()) return null
  const safe = safeInternalReturnPath(returnTo, '')
  return safe ? { returnTo: safe, returnLabel: returnLabel.trim().slice(0, 60) } : null
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * The return context for this record, or `fallback`. Router state lives in
 * the history entry, so it survives a reload; links that stay on the same
 * record (tabs, next/previous) forward it with `forwardReturnState`. With a
 * `scope`, the context is also remembered in this tab's sessionStorage, so a
 * round trip through a linked page (a submission, say) keeps it.
 */
export function useReturnContext(fallback: ReturnContext, scope?: string): ReturnContext {
  const location = useLocation()
  const activity = activityReturnPath(new URLSearchParams(location.search).get('return_to'))
  const fromState = activity ? { returnTo: activity, returnLabel: 'Activity' } : readReturnContext(location.state)
  const store = scope ? storage() : null
  if (fromState) {
    try {
      store?.setItem(RETURN_PREFIX + scope, JSON.stringify(fromState))
    } catch {
      // Storage full or disabled: router state still works for this view.
    }
    return fromState
  }
  try {
    const remembered = store ? readReturnContext(JSON.parse(store.getItem(RETURN_PREFIX + scope) || 'null')) : null
    if (remembered) return remembered
  } catch {
    // Ignore malformed storage.
  }
  return fallback
}

/** State to pass on links that stay within the same record so its Back link keeps working. */
export function forwardReturnState(state: unknown): ReturnContext | undefined {
  return readReturnContext(state) || undefined
}

/** Should a list restore its saved scroll position for this navigation? */
export function shouldRestoreList(navigationType: string, state: unknown) {
  return navigationType === 'POP' || Boolean(state && typeof state === 'object' && (state as ReturnState).restoreList === true)
}

/**
 * Saves the window scroll position for this list URL while the user scrolls,
 * and restores it once `ready` (rows rendered) when the user comes back.
 */
export function useListScrollMemory(ready: boolean) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const pathname = location.pathname
  const key = SCROLL_PREFIX + pathname
  const restoreRef = useRef(shouldRestoreList(navigationType, location.state))
  const restoredRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame = 0
    const save = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Do not overwrite the saved position before it has been restored.
        if (restoreRef.current && !restoredRef.current) return
        // A suspended route transition keeps this list mounted (hidden) after the URL has
        // already moved on; scroll events then belong to the next page.
        if (window.location.pathname !== pathname) return
        try {
          storage()?.setItem(key, String(Math.round(window.scrollY)))
        } catch {
          // Ignore storage failures.
        }
      })
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', save)
    }
  }, [key, pathname])

  useEffect(() => {
    if (!ready || restoredRef.current) return
    restoredRef.current = true
    if (!restoreRef.current) {
      // A fresh visit replaces a position left by an earlier visit, so a later Back
      // without any scrolling cannot jump to that stale position.
      try {
        storage()?.setItem(key, String(Math.round(window.scrollY)))
      } catch {
        // Ignore storage failures.
      }
      return
    }
    const saved = Number(storage()?.getItem(key))
    if (!Number.isFinite(saved) || saved <= 0) return
    requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: 'instant' as ScrollBehavior }))
  }, [key, ready])
}

/** True when a key press belongs to a text field, select, or rich-text editor rather than a page shortcut. */
export function isEditableTarget(target: EventTarget | null) {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false
  const element = target as HTMLElement
  return Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]'))
}

/**
 * Single-letter queue shortcuts (J next, K previous), ignored while typing,
 * inside dialogs, or with modifier keys held.
 */
export function queueShortcutDirection(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target' | 'defaultPrevented'>): 'next' | 'previous' | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  if (isEditableTarget(event.target)) return null
  const key = event.key.toLowerCase()
  return key === 'j' ? 'next' : key === 'k' ? 'previous' : null
}

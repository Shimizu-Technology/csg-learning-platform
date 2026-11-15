import { useEffect, useRef, useState, type RefObject } from 'react'

/*
 * The small motion set (U-6.2, design spec §6). Only transform and opacity
 * animate, plus the accordion's grid-template-rows; durations and easings are
 * the tokens in index.css. Nothing here delays input or navigation, and under
 * prefers-reduced-motion every change is instant.
 */

export const MOTION = {
  /** --duration-accordion: accordion expand/collapse and list inserts. */
  accordion: 200,
  /** --duration-tab: a tab's panel fading in. */
  tab: 160,
  /** --duration-page: main content fading in on a page change. */
  page: 160,
  /** --ease-out */
  easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
} as const

/** True when motion should be skipped: the OS asks for it, or there is no way to tell (tests, old browsers). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The part of a path that names the page: "/admin/grading" and
 * "/messages/dm" (so switching conversations, or changing a filter in the
 * query string, is not a page change).
 */
export function pageKey(pathname: string) {
  return pathname.split('/').filter(Boolean).slice(0, 2).join('/')
}

/**
 * Fades the main content in when the page changes (160ms, opacity only). There
 * is no exit animation and the navigation doesn't move. Uses the Web
 * Animations API so the page is never remounted.
 */
export function usePageFade(ref: RefObject<HTMLElement | null>, pathname: string) {
  const key = pageKey(pathname)
  const previous = useRef(key)
  useEffect(() => {
    if (previous.current === key) return
    previous.current = key
    const element = ref.current
    if (!element || typeof element.animate !== 'function' || prefersReducedMotion()) return
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.page, easing: MOTION.easeOut })
    return () => animation.cancel()
  }, [key, ref])
}

/**
 * Keys that appeared after the list first loaded, so only rows added while
 * the page is open animate in (list insert, 200ms). Rows already there, and
 * a whole new list after a reload (`ready` turning true again) or a filter or
 * page change (`scope`), render still.
 */
export function useInsertedKeys(keys: ReadonlyArray<string | number>, { ready = true, scope = '' }: { ready?: boolean; scope?: string } = {}) {
  const seen = useRef<{ scope: string; keys: Set<string | number> } | null>(null)
  const [inserted, setInserted] = useState<ReadonlySet<string | number>>(() => new Set())
  const signature = keys.join('\u0000')
  const wasReady = useRef(false)
  useEffect(() => {
    const reloaded = ready && !wasReady.current
    wasReady.current = ready
    if (!ready) return
    if (!seen.current || reloaded || seen.current.scope !== scope) {
      seen.current = { scope, keys: new Set(keys) }
      setInserted(new Set())
      return
    }
    const known = seen.current.keys
    const fresh = keys.filter((key) => !known.has(key))
    fresh.forEach((key) => known.add(key))
    if (fresh.length) setInserted(new Set(fresh))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare by content, not array identity
  }, [ready, scope, signature])
  return inserted
}

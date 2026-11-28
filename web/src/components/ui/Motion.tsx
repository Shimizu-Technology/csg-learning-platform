import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MOTION, prefersReducedMotion } from '../../lib/motion'

type CollapseState = 'open' | 'opening' | 'closing' | 'closed'

/**
 * Accordion body (design spec §6): 200ms on --ease-out, animating
 * grid-template-rows 0fr → 1fr so the content's own layout never jumps. Closed
 * content is unmounted (or `hidden` with keepMounted), so it is out of the tab
 * order either way. Under reduced motion it opens and closes instantly.
 */
export function Collapse({ open, children, id, className = '', keepMounted = false }: {
  open: boolean
  children: ReactNode
  id?: string
  className?: string
  /** Keep closed content in the DOM (hidden), for panels other code queries. */
  keepMounted?: boolean
}) {
  const [state, setState] = useState<CollapseState>(open ? 'open' : 'closed')
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    if (prefersReducedMotion()) { setState(open ? 'open' : 'closed'); return }
    setState(open ? 'opening' : 'closing')
  }, [open])

  useEffect(() => {
    if (state !== 'opening' && state !== 'closing') return
    // Two frames: the first paints 0fr (or 1fr), the second starts the transition.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => ref.current?.setAttribute('data-expanded', state === 'opening' ? 'true' : 'false'))
    })
    const done = () => setState((current) => (current === 'opening' ? 'open' : current === 'closing' ? 'closed' : current))
    // transitionend is the normal path; the timer covers a tab in the background.
    const timer = window.setTimeout(done, MOTION.accordion + 80)
    const element = ref.current
    const onEnd = (event: TransitionEvent) => { if (event.target === element && event.propertyName === 'grid-template-rows') done() }
    element?.addEventListener('transitionend', onEnd)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      element?.removeEventListener('transitionend', onEnd)
    }
  }, [state])

  if (state === 'closed' && !keepMounted) return null
  const expanded = state === 'open' ? 'true' : 'false'
  return (
    <div
      ref={ref}
      id={id}
      className={`motion-collapse ${className}`.trim()}
      data-state={state}
      data-expanded={state === 'opening' || state === 'closing' ? undefined : expanded}
      hidden={state === 'closed' || undefined}
      inert={state === 'closing' || undefined}
    >
      <div className="motion-collapse-body">{children}</div>
    </div>
  )
}

/**
 * A row of TabButtons (role="tablist") whose 3px ruby indicator slides to the
 * selected tab (220ms, transform and width) instead of jumping. Under reduced
 * motion it jumps. Children are TabButtons; the selected one is found by
 * aria-selected / aria-pressed.
 */
export function TabList({
  label,
  children,
  className = '',
  scrollable = false,
}: {
  label: string
  children: ReactNode
  className?: string
  /** Show left/right scroll buttons and edge fades whenever tabs overflow horizontally. */
  scrollable?: boolean
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  const [scrollState, setScrollState] = useState({ overflowing: false, left: false, right: false })
  const selectedIndex = Children.toArray(children).findIndex((child) => isValidElement<{ selected?: boolean }>(child) && child.props.selected)

  const syncScrollState = useCallback(() => {
    const list = listRef.current
    if (!scrollable || !list) return
    const wrapper = wrapperRef.current
    const availableWidth = wrapper && wrapper.clientWidth > 0 ? wrapper.clientWidth : list.clientWidth
    const overflowing = list.scrollWidth > availableWidth + 2
    const left = overflowing && list.scrollLeft > 2
    const right = overflowing && list.scrollLeft + list.clientWidth < list.scrollWidth - 2
    setScrollState((current) =>
      current.overflowing === overflowing && current.left === left && current.right === right
        ? current
        : { overflowing, left, right },
    )
  }, [scrollable])

  const ensureSelectedVisible = useCallback((smooth: boolean) => {
    const list = listRef.current
    if (!scrollable || !list || list.scrollWidth <= list.clientWidth + 2) return
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]')
    if (!selected) return
    const pad = 24
    const leftEdge = selected.offsetLeft
    const rightEdge = leftEdge + selected.offsetWidth
    let nextLeft: number | null = null
    if (leftEdge < list.scrollLeft + pad) {
      nextLeft = Math.max(0, leftEdge - pad)
    } else if (rightEdge > list.scrollLeft + list.clientWidth - pad) {
      nextLeft = Math.min(list.scrollWidth - list.clientWidth, rightEdge - list.clientWidth + pad)
    }
    if (nextLeft === null) return
    const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto'
    if (typeof list.scrollTo === 'function') list.scrollTo({ left: nextLeft, behavior })
    else list.scrollLeft = nextLeft
  }, [scrollable])

  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]')
      if (!selected) { indicator.style.opacity = '0'; syncScrollState(); return }
      // The first placement, and resizes, never animate.
      const animate = placed.current && !prefersReducedMotion()
      indicator.dataset.animate = animate ? 'true' : 'false'
      indicator.style.opacity = '1'
      indicator.style.width = `${selected.offsetWidth}px`
      indicator.style.transform = `translateX(${selected.offsetLeft}px)`
      ensureSelectedVisible(placed.current)
      placed.current = true
      syncScrollState()
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      placed.current = false
      place()
    })
    observer.observe(list)
    if (wrapperRef.current) observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [selectedIndex, children, ensureSelectedVisible, syncScrollState])

  const scrollByStep = (direction: -1 | 1) => {
    const list = listRef.current
    if (!list) return
    const step = list.clientWidth > 0 ? Math.max(40, Math.min(Math.round(list.clientWidth * 0.75), Math.max(40, list.clientWidth - 24))) : 160
    const delta = direction * step
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    if (typeof list.scrollBy === 'function') list.scrollBy({ left: delta, behavior })
    else list.scrollLeft += delta
    syncScrollState()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const list = listRef.current
    if (!list) return
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
    if (tabs.length < 2) return
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (currentIndex === -1) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length
    tabs[nextIndex]?.focus(scrollable ? { preventScroll: true } : undefined)
    tabs[nextIndex]?.click()
  }

  const overflowing = scrollable && scrollState.overflowing

  if (!scrollable) {
    return (
      <div ref={listRef} role="tablist" aria-label={label} data-tab-indicator="" onKeyDown={handleKeyDown} className={`relative ${className}`.trim()}>
        {children}
        <span ref={indicatorRef} aria-hidden="true" className="tab-indicator" style={{ opacity: 0 }} />
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="relative flex min-w-0 items-center gap-1">
      {overflowing && (
        <button
          type="button"
          aria-label={`Scroll ${label} left`}
          disabled={!scrollState.left}
          onClick={() => scrollByStep(-1)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:opacity-35 lg:min-h-9 lg:min-w-9"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <div className="relative min-w-0 flex-1">
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          data-tab-indicator=""
          onScroll={syncScrollState}
          onKeyDown={handleKeyDown}
          className={`relative min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`.trim()}
        >
          {children}
          <span ref={indicatorRef} aria-hidden="true" className="tab-indicator" style={{ opacity: 0 }} />
        </div>
        {scrollState.left && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-raised to-transparent" />
        )}
        {scrollState.right && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-raised to-transparent" />
        )}
      </div>
      {overflowing && (
        <button
          type="button"
          aria-label={`Scroll ${label} right`}
          disabled={!scrollState.right}
          onClick={() => scrollByStep(1)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:opacity-35 lg:min-h-9 lg:min-w-9"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** A tab's panel: fades in from 4px below (160ms) when the tab changes. Give it `key` = the selected tab. */
export function TabPanel({ children, className = '', ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tabpanel" className={`motion-tab-panel ${className}`.trim()} {...props}>{children}</div>
}

/**
 * Horizontal scrollable link strip for desktop workspace sections (`CohortWorkspace`,
 * `StudentWorkspace`). Shows Prev/Next scroll buttons and edge fades whenever the links
 * overflow their wrapper, and keeps the active `[aria-current="page"]` link in view.
 */
export function ScrollableNavStrip({
  label,
  activeKey,
  children,
  className = '',
}: {
  label: string
  activeKey?: string | number
  children: ReactNode
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const programmaticScrollLeftRef = useRef<number | null>(null)
  const prevActiveKeyRef = useRef(activeKey)
  const [scrollState, setScrollState] = useState({ overflowing: false, left: false, right: false })

  const syncScrollState = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const wrapper = wrapperRef.current
    const availableWidth = wrapper && wrapper.clientWidth > 0 ? wrapper.clientWidth : scroller.clientWidth
    const overflowing = scroller.scrollWidth > availableWidth + 2
    const left = overflowing && scroller.scrollLeft > 2
    const right = overflowing && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2
    setScrollState((current) =>
      current.overflowing === overflowing && current.left === left && current.right === right
        ? current
        : { overflowing, left, right },
    )
  }, [])

  const alignActive = useCallback((force = false) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (force || !userScrolledRef.current) {
      const active = scroller.querySelector<HTMLElement>('[aria-current="page"], .tab-selected')
      if (active && scroller.scrollWidth > scroller.clientWidth + 2) {
        const pad = 24
        const leftEdge = active.offsetLeft
        const rightEdge = leftEdge + active.offsetWidth
        let nextLeft: number | null = null
        if (leftEdge < scroller.scrollLeft + pad) nextLeft = Math.max(0, leftEdge - pad)
        else if (rightEdge > scroller.scrollLeft + scroller.clientWidth - pad) {
          nextLeft = Math.min(scroller.scrollWidth - scroller.clientWidth, rightEdge - scroller.clientWidth + pad)
        }
        if (nextLeft !== null) {
          programmaticScrollLeftRef.current = Math.round(nextLeft)
          if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ left: nextLeft, behavior: 'auto' })
          else scroller.scrollLeft = nextLeft
        }
      }
    }
    syncScrollState()
  }, [syncScrollState])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (prevActiveKeyRef.current !== activeKey) {
      prevActiveKeyRef.current = activeKey
      userScrolledRef.current = false
    }
    alignActive(false)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => alignActive(false))
    observer.observe(scroller)
    if (wrapperRef.current) observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [activeKey, children, alignActive])

  // Re-align after arrows mount and shrink the scroll viewport, unless the user manually scrolled.
  useLayoutEffect(() => {
    if (scrollState.overflowing) alignActive(false)
  }, [scrollState.overflowing, alignActive])

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller) {
      const target = programmaticScrollLeftRef.current
      if (target !== null && Math.abs(scroller.scrollLeft - target) <= 2) {
        programmaticScrollLeftRef.current = null
      } else {
        programmaticScrollLeftRef.current = null
        userScrolledRef.current = true
      }
    }
    syncScrollState()
  }, [syncScrollState])

  const scrollByStep = (direction: -1 | 1) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    userScrolledRef.current = true
    programmaticScrollLeftRef.current = null
    const step = scroller.clientWidth > 0 ? Math.max(40, Math.min(Math.round(scroller.clientWidth * 0.75), Math.max(40, scroller.clientWidth - 24))) : 160
    const delta = direction * step
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ left: delta, behavior })
    else scroller.scrollLeft += delta
    syncScrollState()
  }

  return (
    <div ref={wrapperRef} className={`relative flex min-w-0 items-center gap-1 ${className}`.trim()}>
      {scrollState.overflowing && (
        <button
          type="button"
          aria-label={`Scroll ${label} left`}
          disabled={!scrollState.left}
          onClick={() => scrollByStep(-1)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:opacity-35 lg:min-h-9 lg:min-w-9"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </div>
        {scrollState.left && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-page to-transparent" />
        )}
        {scrollState.right && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-page to-transparent" />
        )}
      </div>
      {scrollState.overflowing && (
        <button
          type="button"
          aria-label={`Scroll ${label} right`}
          disabled={!scrollState.right}
          onClick={() => scrollByStep(1)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:opacity-35 lg:min-h-9 lg:min-w-9"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

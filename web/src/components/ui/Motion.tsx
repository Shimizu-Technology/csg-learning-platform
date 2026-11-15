import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
export function TabList({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  const selectedIndex = Children.toArray(children).findIndex((child) => isValidElement<{ selected?: boolean }>(child) && child.props.selected)

  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]')
      if (!selected) { indicator.style.opacity = '0'; return }
      // The first placement, and resizes, never animate.
      indicator.dataset.animate = placed.current && !prefersReducedMotion() ? 'true' : 'false'
      indicator.style.opacity = '1'
      indicator.style.width = `${selected.offsetWidth}px`
      indicator.style.transform = `translateX(${selected.offsetLeft}px)`
      placed.current = true
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      placed.current = false
      place()
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [selectedIndex, children])

  return (
    <div ref={listRef} role="tablist" aria-label={label} data-tab-indicator="" className={`relative ${className}`.trim()}>
      {children}
      <span ref={indicatorRef} aria-hidden="true" className="tab-indicator" style={{ opacity: 0 }} />
    </div>
  )
}

/** A tab's panel: fades in from 4px below (160ms) when the tab changes. Give it `key` = the selected tab. */
export function TabPanel({ children, className = '', ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tabpanel" className={`motion-tab-panel ${className}`.trim()} {...props}>{children}</div>
}

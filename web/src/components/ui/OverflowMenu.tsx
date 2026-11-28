import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { IconButton } from './Button'

export type OverflowMenuItem =
  | { key: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; tone?: 'danger' }
  | { key: string; label: ReactNode; icon?: ReactNode; to: string; tone?: 'danger' }

/**
 * A ⋯ button that opens a small menu of secondary actions (spec §4.2, §4.6).
 * Arrow keys move between items, Escape or choosing an action closes it and
 * returns focus to the button, and a tap outside closes it. Items can be buttons or real links.
 */
export function OverflowMenu({ label, items, size = 'md', align = 'right', className = '' }: {
  label: string
  items: OverflowMenuItem[]
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ upward: boolean; maxHeight: number | null }>({ upward: false, maxHeight: null })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useLayoutEffect(() => {
    if (!open) {
      setPlacement({ upward: false, maxHeight: null })
      return
    }
    const updatePlacement = () => {
      const triggerEl = buttonRef.current
      const menuEl = menuRef.current
      if (!triggerEl || !menuEl) return
      const trigger = triggerEl.getBoundingClientRect()
      const naturalHeight = Math.max(menuEl.scrollHeight, menuEl.getBoundingClientRect().height)
      if (naturalHeight === 0) return

      let clipTop = 0
      let clipBottom = window.innerHeight
      let ancestor = triggerEl.parentElement
      while (ancestor && ancestor !== document.documentElement) {
        const overflowY = window.getComputedStyle(ancestor).overflowY
        if (/auto|scroll|hidden|clip/.test(overflowY)) {
          const rect = ancestor.getBoundingClientRect()
          if (rect.height > 0) {
            clipTop = Math.max(clipTop, rect.top)
            clipBottom = Math.min(clipBottom, rect.bottom)
          }
        }
        ancestor = ancestor.parentElement
      }

      const spaceBelow = clipBottom - trigger.bottom - 8
      const spaceAbove = trigger.top - clipTop - 8
      const upward = spaceBelow < naturalHeight && spaceAbove > spaceBelow
      const available = Math.floor(upward ? spaceAbove : spaceBelow)
      const maxHeight = available < naturalHeight ? Math.max(88, available) : null
      setPlacement((current) =>
        current.upward === upward && current.maxHeight === maxHeight ? current : { upward, maxHeight },
      )
    }
    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])
    const frame = requestAnimationFrame(() => menuItems()[0]?.focus())
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (event.key === 'Tab') {
        setOpen(false)
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const list = menuItems()
      if (!list.length) return
      event.preventDefault()
      const index = list.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? list.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length
      list[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const itemClass = (tone?: 'danger') => `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken lg:min-h-10 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${tone === 'danger' ? 'text-danger-ink' : 'text-ink [&_svg]:text-ink-muted'}`

  return (
    <div className={`relative shrink-0 ${className}`}>
      <IconButton
        ref={buttonRef}
        label={label}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={open ? 'bg-surface-sunken text-ink' : ''}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={placement.maxHeight ? { maxHeight: `${placement.maxHeight}px` } : undefined}
          className={`popover-menu absolute z-50 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface-overlay p-1.5 shadow-overlay ${
            placement.upward
              ? align === 'right'
                ? 'bottom-full right-0 mb-1.5 origin-bottom-right'
                : 'bottom-full left-0 mb-1.5 origin-bottom-left'
              : align === 'right'
                ? 'top-full right-0 mt-1.5 origin-top-right'
                : 'top-full left-0 mt-1.5 origin-top-left'
          }`}
        >
          {items.map((item) => 'to' in item ? (
            <Link key={item.key} role="menuitem" to={item.to} onClick={() => setOpen(false)} className={itemClass(item.tone)}>
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          ) : (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                // The item is about to unmount: put focus back on the ⋯ button
                // first so keyboard users keep their place. An action that opens
                // a dialog can still move focus into it.
                buttonRef.current?.focus()
                item.onSelect()
              }}
              className={itemClass(item.tone)}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

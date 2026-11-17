import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import type { ReturnContext } from '../../lib/navigationContext'
import { useMediaQuery } from '../../lib/useMediaQuery'

/** Compact disclosure of ordinary section links. Only activating a link navigates. */
export function WorkspaceSectionMenu({
  label,
  value,
  sections,
  state,
}: {
  label: string
  value: string
  sections: Array<{ to: string; label: string }>
  state?: ReturnContext
}) {
  const isPhone = useMediaQuery('not all and (min-width: 1024px)')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState({ above: false, height: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const disclosure = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = sections.find((section) => section.to === value)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!disclosure.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  // The client reads the media query synchronously; desktop retains only its original links.
  if (!isPhone) return null
  return (
    <div
      ref={disclosure}
      className="relative lg:hidden"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className="app-control flex min-h-11 w-full items-center justify-between gap-3 text-left text-base"
        onClick={() => {
          if (!open && button.current) {
            const rect = button.current.getBoundingClientRect()
            const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary navigation"]')
            const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top - 12 : window.innerHeight - 16
            const below = bottom - rect.bottom - 8
            const above = rect.top - 64
            const desired = Math.min(sections.length * 44 + 10, window.innerHeight * 0.6)
            const upward = below < desired && above > below
            setPlacement({ above: upward, height: Math.max(44, Math.min(desired, upward ? above : below)) })
          }
          setOpen((value) => !value)
        }}
      >
        <span className="min-w-0 truncate">Section: {current?.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={id}
          aria-label={label}
          style={{ maxHeight: placement.height }}
          className={
            'absolute inset-x-0 z-30 overflow-y-auto rounded-xl border border-line bg-surface-raised p-1 shadow-overlay ' +
            (placement.above ? 'bottom-full mb-2' : 'top-full mt-2')
          }
        >
          {sections.map((section) => (
            <li key={section.to}>
              <Link
                to={section.to}
                state={state}
                aria-current={section.to === value ? 'page' : undefined}
                className={
                  'flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold ' +
                  'hover:bg-surface-sunken ' +
                  (section.to === value ? 'bg-surface-selected text-ink' : 'text-ink-secondary')
                }
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  setOpen(false)
                  button.current?.focus()
                }}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useId, useRef, useState, type ReactNode } from 'react'
import { adminIcon, moreIcon } from '../../lib/shellNavigation'

/** A disclosure of ordinary navigation links: Tab works naturally, arrows are optional shortcuts. */
export function NavDisclosure({ label, compact, active, children }: { label: string; compact?: boolean; active?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const Icon = label === 'Admin' ? adminIcon : moreIcon
  // Empty groups contain only empty mapped arrays.
  if (!Array.isArray(children) || children.length === 0) return null
  return <div className="border-t border-line pt-2" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); button.current?.focus() }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const links = Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('a') || [])
    if (!links.length) return
    event.preventDefault()
    setOpen(true)
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' || (event.key === 'ArrowUp' && index < 0) ? links.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + links.length) % links.length
    requestAnimationFrame(() => links[next]?.focus())
  }}>
    <button ref={button} type="button" aria-label={label} title={compact ? label : undefined} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={`pressable flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium ${compact ? 'justify-center' : 'gap-3'} ${active ? 'nav-selected' : 'text-ink-secondary hover:bg-surface-sunken'}`}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />{!compact && label}
    </button>
    <div ref={panel} id={id} hidden={!open} className="space-y-1 pt-1">{children}</div>
  </div>
}

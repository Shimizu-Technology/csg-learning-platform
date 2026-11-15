import { useEffect, useId, useRef, useState } from 'react'
import { Code2, ListChecks, Play, Plus, SquareTerminal, Type } from 'lucide-react'
import { ADDABLE_BLOCK_TYPES, type BlockType } from './blockDraft'

export const BLOCK_ICONS: Record<BlockType, typeof Type> = {
  text: Type,
  video: Play,
  recording: Play,
  exercise: Code2,
  code_challenge: SquareTerminal,
  checkpoint: ListChecks,
}

/**
 * The + between blocks (spec: "add between"). Opens a menu of block types;
 * arrow keys move through it, Escape closes it and returns focus.
 */
export function AddBlockMenu({ label, onAdd, disabled = false, disabledReason }: {
  label: string
  onAdd: (type: BlockType) => void
  disabled?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])
    const frame = requestAnimationFrame(() => items()[0]?.focus())
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
      const list = items()
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

  return (
    <div className="relative flex h-11 items-center gap-2" data-block-adder>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={disabled ? disabledReason : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="grid h-11 w-11 place-items-center rounded-full text-ink-secondary transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:text-ink-disabled lg:h-8 lg:w-8 [&>span]:hover:border-primary-soft-line"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-surface-raised">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Block type"
          className="popover-menu absolute left-1/2 top-full z-40 mt-1 w-60 -translate-x-1/2 rounded-xl border border-line bg-surface-raised p-1.5 shadow-overlay"
        >
          {ADDABLE_BLOCK_TYPES.map(({ type, label: typeLabel }) => {
            const Icon = BLOCK_ICONS[type]
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onAdd(type)
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken lg:min-h-10"
              >
                <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                {typeLabel}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

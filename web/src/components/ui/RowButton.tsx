import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

interface RowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Neutral fill + 3px ruby indicator (the shared `nav-selected` treatment). */
  selected?: boolean
}

/**
 * A whole row that acts as one button: a conversation, channel, search result,
 * mention suggestion or attachment card. Left-aligned content, a 44px minimum
 * height, the shared press feedback and focus ring, and neutral selection.
 * Callers supply layout (flex/grid, padding, radius) through `className`.
 */
export const RowButton = forwardRef<HTMLButtonElement, RowButtonProps>(function RowButton(
  { children, selected = false, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-row-button=""
      data-selected={selected ? 'true' : undefined}
      className={`pressable min-h-11 min-w-0 text-left disabled:pointer-events-none disabled:opacity-50 ${
        selected ? 'nav-selected' : 'hover:bg-surface-sunken'
      } ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
    </button>
  )
})

/** Unread/count pill: ruby, white tabular numbers, 20px tall; caps at 99+. */
export function CountBadge({ count, label, className = '' }: { count: number; label?: string; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      data-count-badge=""
      className={`inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ruby-600 px-1.5 text-xs font-semibold leading-none tabular-nums text-on-action ${className}`.trim()}
    >
      {count > 99 ? '99+' : count}
      {label && <span className="sr-only"> {label}</span>}
    </span>
  )
}

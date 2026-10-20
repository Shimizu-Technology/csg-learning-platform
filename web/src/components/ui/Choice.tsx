import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

/*
 * Selection controls. Selection is neutral (slate fill or ink outline) with a
 * ruby indicator, never a red or inverse fill, so ruby keeps meaning "the
 * action" and red keeps meaning "something is wrong". All are 44px tall on
 * touch; the dense variants drop to 36px only at the desktop breakpoint.
 */

const press = 'select-none transition-[background-color,border-color,color,box-shadow,scale] duration-[120ms] ease-out active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50'

interface ChoiceProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected: boolean
  children: ReactNode
  /** Count shown after the label (tabular numbers, muted). */
  count?: number | string | null
  /** 36px on desktop toolbars; touch keeps 44px. */
  dense?: boolean
}

/** A filter chip: rounded-full, ink outline + ruby dot when selected. Uses aria-pressed. */
export const FilterChip = forwardRef<HTMLButtonElement, ChoiceProps>(function FilterChip(
  { selected, children, count, dense = false, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-selected={selected ? 'true' : undefined}
      className={`${press} inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold ${dense ? 'lg:min-h-9' : ''} ${
        selected ? 'border-ink bg-slate-100 text-ink' : 'border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken hover:text-ink'
      } ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {selected && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ruby-600" />}
      {children}
      {count !== undefined && count !== null && <span className="text-xs tabular-nums text-ink-muted">{count}</span>}
    </button>
  )
})

interface TabButtonProps extends ChoiceProps {
  /** Use role="tab" semantics (inside a role="tablist"); otherwise aria-pressed. */
  asTab?: boolean
}

/** An underline tab: ink text + 3px ruby underline when selected. */
export const TabButton = forwardRef<HTMLButtonElement, TabButtonProps>(function TabButton(
  { selected, children, count, dense = false, asTab = false, className = '', type = 'button', ...props },
  ref,
) {
  const state = asTab ? { role: 'tab', 'aria-selected': selected } : { 'aria-pressed': selected }
  return (
    <button
      ref={ref}
      type={type}
      {...state}
      data-selected={selected ? 'true' : undefined}
      className={`${press} inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-semibold ${dense ? 'lg:min-h-9' : ''} ${
        selected ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
      } ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
      {count !== undefined && count !== null && <span className={`rounded-full px-1.5 text-xs tabular-nums ${selected ? 'bg-slate-100 text-ink' : 'text-ink-muted'}`}>{count}</span>}
    </button>
  )
})

/** One option in a SegmentedControl group: neutral raised fill when selected. */
export const SegmentButton = forwardRef<HTMLButtonElement, ChoiceProps>(function SegmentButton(
  { selected, children, count, dense = false, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-selected={selected ? 'true' : undefined}
      className={`${press} inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${dense ? 'lg:min-h-9' : ''} ${
        selected ? 'bg-surface-raised text-ink shadow-raised ring-1 ring-line-strong' : 'text-ink-secondary hover:text-ink'
      } ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
      {count !== undefined && count !== null && <span className="text-xs tabular-nums text-ink-muted">{count}</span>}
    </button>
  )
})

/** Wrapper for SegmentButtons: a sunken track. Give it an aria-label. */
export function SegmentedControl({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-sunken p-1 ${className}`.trim()}>
      {children}
    </div>
  )
}

interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** `danger` is for destructive inline actions only. */
  tone?: 'link' | 'quiet' | 'danger'
}

/**
 * An action that reads as text ("Message your instructor", "Show all"): a
 * real button with link styling and a 44px touch target that collapses to
 * the text height on desktop pointers.
 */
export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(
  { children, tone = 'link', className = '', type = 'button', ...props },
  ref,
) {
  const tones = {
    link: 'text-ink underline underline-offset-2 hover:text-ruby-700',
    quiet: 'text-ink-secondary hover:text-ink hover:underline underline-offset-2',
    danger: 'text-danger-700 underline-offset-2 hover:underline',
  }
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex min-h-11 items-center gap-1 rounded-md font-semibold transition-colors duration-[120ms] disabled:pointer-events-none disabled:opacity-50 lg:min-h-0 ${tones[tone]} ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
    </button>
  )
})

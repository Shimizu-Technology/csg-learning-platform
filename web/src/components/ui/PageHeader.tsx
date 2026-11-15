import { useId, type ReactNode } from 'react'
import { ChevronDown, Filter } from 'lucide-react'
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu'

interface PageHeaderProps {
  /** Older pages only; list and hub pages use the title and context line (spec §4.1). */
  eyebrow?: string
  title: string
  /** The context line under the title: scope, date or a count. */
  description?: ReactNode
  /** Scope control ("Showing: All cohorts"), always visible when the page can be filtered by cohort. */
  scope?: ReactNode
  /** Filters, then the primary action. */
  actions?: ReactNode
  /** Secondary actions under ⋯, including Refresh where a page keeps manual refresh (T-8). */
  menu?: OverflowMenuItem[]
  meta?: ReactNode
}

/**
 * The header for list and hub pages (U-6.3, spec §4.1): title and context line
 * on the left; scope control, filters and the primary action on the right,
 * then ⋯ for anything secondary. On phones the actions wrap to a full-width
 * row under the title.
 */
export function PageHeader({ eyebrow, title, description, scope, actions, menu, meta }: PageHeaderProps) {
  const hasActions = Boolean(scope || actions || menu?.length)
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3" data-page-header="">
      <div className="min-w-0 flex-1 basis-[220px]">
        {eyebrow && <p className="app-eyebrow">{eyebrow}</p>}
        <h1 className={`${eyebrow ? 'mt-2' : ''} app-title [overflow-wrap:anywhere]`}>{title}</h1>
        {description && <div className="app-description mt-1.5 tabular-nums" data-page-context="">{description}</div>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs tabular-nums text-ink-secondary">{meta}</div>}
      </div>
      {hasActions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto" data-page-actions="">
          {scope}
          {actions}
          {menu && menu.length > 0 && <OverflowMenu label="More actions" items={menu} />}
        </div>
      )}
    </header>
  )
}

export interface ScopeOption {
  value: string
  label: string
}

/**
 * "Showing: All cohorts ▾" (spec §4.1). A native select, so it works with a
 * keyboard, a screen reader and a phone's picker. It turns tinted when a
 * filter is on, so a filtered page never looks unfiltered.
 */
export function ScopeControl({ label = 'cohort', value, options, onChange, allValue = '' }: {
  /** What is being scoped, for the accessible name ("Showing cohort"). */
  label?: string
  value: string
  options: ScopeOption[]
  onChange: (value: string) => void
  /** The option that means "no filter". */
  allValue?: string
}) {
  const id = useId()
  const filtered = value !== allValue
  const current = options.find((option) => option.value === value)?.label || options[0]?.label || ''
  return (
    <div
      className={`relative inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors duration-150 focus-within:ring-2 focus-within:ring-focus/25 lg:min-h-10 ${filtered ? 'border-primary-soft-line bg-primary-soft text-ink' : 'border-line-strong bg-surface-raised text-ink-secondary hover:border-line-control'}`}
      data-scope-control={filtered ? 'filtered' : 'all'}
    >
      <Filter className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span aria-hidden="true">Showing:</span>
      <span aria-hidden="true" className="max-w-[14rem] truncate text-ink">{current}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">Showing {label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

/** Scope options for a cohort filter: "All cohorts" first, then each cohort by name. */
export function cohortScopeOptions(cohorts: ReadonlyArray<{ id: number; name: string }>, allLabel = 'All cohorts'): ScopeOption[] {
  return [{ value: '', label: allLabel }, ...cohorts.map((cohort) => ({ value: String(cohort.id), label: cohort.name }))]
}

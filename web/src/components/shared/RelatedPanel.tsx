import { useId, type MouseEvent } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { PreviewLink } from '../../contexts/PreviewNavigationContext'
import { listLinkState } from '../../lib/navigationContext'
import type { RelatedRow } from '../../lib/recordRelated'
import { Button } from '../ui/Button'

interface RelatedPanelProps {
  rows: RelatedRow[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** Label for the destination's Back link ("Submission #812"), so "view all" comes back here. */
  returnLabel?: string
  /**
   * Runs before a row's link is followed, with the destination and the router
   * state it would carry, e.g. to ask about unsaved feedback first. Call
   * `preventDefault()` and navigate yourself to hold the navigation.
   */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, to: string, state: unknown) => void
  className?: string
}

const rowClass = 'flex min-h-11 w-full items-center gap-3 border-b border-line px-4 py-2 text-left text-sm last:border-b-0 sm:px-5'
const interactive = 'transition-colors duration-150 hover:bg-surface-sunken focus-visible:bg-surface-sunken'

function Trailing({ row, linked }: { row: RelatedRow; linked: boolean }) {
  const hasCount = typeof row.count === 'number'
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums text-ink-muted">
      {row.value && <span className={row.attention && !hasCount ? 'text-warning-800' : ''}>{row.value}</span>}
      {hasCount && (
        <span
          className={`inline-flex min-w-6 justify-center rounded-full border px-1.5 py-0.5 ${row.count === 0 ? 'border-transparent text-ink-muted' : row.attention ? 'border-warning-200 bg-warning-50 text-warning-800' : 'border-line bg-surface-sunken text-ink-secondary'}`}
          data-related-count=""
        >
          {row.count}
        </span>
      )}
      {linked && <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
    </span>
  )
}

/**
 * The records connected to this one (L-0.4, spec §4.3): a card beside the
 * record on desktop and below it on phones. Each row has an icon, a label and a
 * count or short value, and opens a focused list that keeps the context. Rows
 * with zero still show, with a quiet count, so staff know the link exists.
 */
export function RelatedPanel({ rows, loading = false, error, onRetry, returnLabel, onNavigate, className = '' }: RelatedPanelProps) {
  const location = useLocation()
  const state = returnLabel ? listLinkState(location, returnLabel) : undefined
  const headingId = useId()

  return (
    <aside aria-labelledby={headingId} className={`app-surface overflow-hidden ${className}`} data-related-panel="">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 id={headingId} className="text-base font-semibold text-ink">Related</h2>
      </div>
      {loading && !rows.length ? (
        <div className="space-y-px" aria-busy="true" aria-label="Loading related items">
          {[0, 1, 2, 3].map((index) => <div key={index} className="flex min-h-11 items-center gap-3 border-b border-line px-4 last:border-b-0 sm:px-5"><span className="h-4 w-4 rounded bg-surface-sunken" /><span className="h-3 w-32 rounded bg-surface-sunken" /></div>)}
        </div>
      ) : error && !rows.length ? (
        <div role="status" className="space-y-3 px-4 py-4 text-sm text-ink-secondary sm:px-5">
          <p>{error}</p>
          {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry</Button>}
        </div>
      ) : (
        <ul>
          {rows.map((row) => {
            const Icon = row.icon
            const content = <>
              <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink" title={row.label}>{row.label}</span>
            </>
            return (
              <li key={row.key} data-related-row={row.key}>
                {row.to ? (
                  <PreviewLink to={row.to} state={state} onClick={onNavigate ? (event) => onNavigate(event, row.to!, state) : undefined} className={`${rowClass} ${interactive}`}>{content}<Trailing row={row} linked /></PreviewLink>
                ) : row.onSelect ? (
                  <button type="button" onClick={row.onSelect} className={`${rowClass} ${interactive}`}>{content}<Trailing row={row} linked /></button>
                ) : (
                  <div className={rowClass}>{content}<Trailing row={row} linked={false} /></div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

/** Scrolls to a section of this page (rubric, evidence…) and moves focus there for keyboard and screen-reader users. */
export function scrollToSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

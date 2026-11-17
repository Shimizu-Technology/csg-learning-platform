import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { RefreshCw } from 'lucide-react'
import { EmptyState } from '../../../components/shared/EmptyState'
import { LoadingSpinner } from '../../../components/shared/LoadingSpinner'
import { NoAccess } from '../../../components/shared/NoAccess'
import { Button } from '../../../components/ui/Button'
import type { DetailState } from '../../../lib/recordDetail'

/*
 * Shared pieces of the staff record pages added in L-5.2. Each page is a
 * record header (spec §4.2), its sections, and a related panel (§4.3) on the
 * right (below on phones), built from one GET /records/:type/:id/detail.
 */

/** The route's `:id`, or null when it isn't a positive whole number. */
export function useRouteId() {
  const { id } = useParams<{ id: string }>()
  const value = Number(id)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Loading, missing and failed states (spec §5). A 404 is "No access", the same as a record that doesn't exist. */
export function DetailGate<T>({ state, label, icon, children }: { state: DetailState<T>; label: string; icon: LucideIcon; children: (detail: T) => ReactNode }) {
  if (state.detail) return <>{children(state.detail)}</>
  if (state.missing) return <NoAccess />
  if (state.loading) return <LoadingSpinner message={`Loading ${label}…`} />
  return (
    <div className="app-page">
      <EmptyState icon={icon} title={`Couldn't load this ${label}`} description={state.error || 'Something went wrong. Try again.'}
        action={<Button onClick={() => void state.reload()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
    </div>
  )
}

/** A titled card on a record page, focusable so a related row can scroll to it. */
export function Section({ id, title, count, children, action }: { id: string; title: string; count?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="app-surface scroll-mt-24 overflow-hidden outline-none" tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold text-ink">{title}</h2>
        <div className="flex items-center gap-2">
          {count && <span className="text-xs font-semibold tabular-nums text-ink-muted">{count}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

/** Label and value pairs in a record's overview. */
export function Facts({ items }: { items: Array<{ label: string; value: ReactNode } | null | false> }) {
  const shown = items.filter(Boolean) as Array<{ label: string; value: ReactNode }>
  return (
    <dl className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
      {shown.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-semibold text-ink-muted">{item.label}</dt>
          <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The page body: content on the left, the related panel on the right (below on phones). */
export function RecordLayout({ children, related }: { children: ReactNode; related: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-6">{children}</div>
      <div className="lg:sticky lg:top-6">{related}</div>
    </div>
  )
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">{children}</p>
}

/** "1:05:30" or "12:04" for a number of seconds. */
export function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

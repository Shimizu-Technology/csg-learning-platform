import { useCallback, useState } from 'react'
import { BookOpen, ExternalLink, Layers3, Receipt, Settings, ShoppingCart, Users } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Button, LinkButton } from '../../../components/ui/Button'
import { api } from '../../../lib/api'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, curriculumPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatShortDateTime } from '../../../lib/format'
import { humanize } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { OfferingDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

type Purchase = OfferingDetail['purchases'][number]

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  pending: { label: 'Checkout started', tone: 'pending' },
  starting: { label: 'Starting checkout', tone: 'pending' },
  setup_failed: { label: 'Checkout didn’t start', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  disputed: { label: 'Disputed', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
}
const money = (cents: number | null | undefined) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`)

/** A self-paced course's offering and purchases (L-3.2, admins): each purchase, its buyer and the enrollment it gave them. */
export function OfferingRecord() {
  const state = useRecordDetail('offering', useRouteId())
  return <DetailGate state={state} label="offering" icon={ShoppingCart} fallback={{ returnTo: '/admin/cohorts', returnLabel: 'Cohorts' }}>{(detail) => <OfferingPage key={detail.id} detail={detail} />}</DetailGate>
}

/**
 * The first page of purchases comes with the record; "Show more" continues
 * before the last one shown. The order (newest first by id) never changes, so
 * a checkout that changes status between pages is listed once.
 */
function useMorePurchases(detail: OfferingDetail) {
  const [rows, setRows] = useState<Purchase[]>(detail.purchases)
  const [next, setNext] = useState<number | null>(detail.purchases_next_before)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadMore = useCallback(async () => {
    if (!next || loading) return
    setLoading(true)
    setError(null)
    const result = await api.getRecordDetail('offering', detail.id, { purchasesBefore: next })
    const page = result.data?.detail
    if (page && page.type === 'offering' && page.id === detail.id) {
      setRows((current) => {
        const seen = new Set(current.map((row) => row.id))
        return [...current, ...page.purchases.filter((row) => !seen.has(row.id))]
      })
      setNext(page.purchases_next_before)
    } else {
      setError(result.error || "Couldn't load more. Try again.")
    }
    setLoading(false)
  }, [detail.id, next, loading])
  return { rows, next, loading, error, loadMore }
}

function OfferingPage({ detail }: { detail: OfferingDetail }) {
  const { cohort } = detail
  const back = useBackLink({ returnTo: cohortPath(cohort.id, 'settings'), returnLabel: `${cohort.name} · Settings` })
  const purchases = useMorePurchases(detail)
  const label = `Purchases · ${detail.title}`
  const counts = detail.status_counts
  const rows: RelatedRow[] = [
    { key: 'cohort', icon: Layers3, label: 'Cohort', value: cohort.name, to: cohortPath(cohort.id) },
    ...(detail.curriculum ? [{ key: 'curriculum', icon: BookOpen, label: 'Curriculum', value: detail.curriculum.name, to: curriculumPath(detail.curriculum.id) }] : []),
    { key: 'purchases', icon: Receipt, label: 'Purchases', count: detail.purchases_count, onSelect: () => scrollToSection('purchases') },
    { key: 'students', icon: Users, label: 'Enrolled', count: detail.enrolled_count, to: cohortPath(cohort.id, 'students') },
    { key: 'settings', icon: Settings, label: 'Offering settings', to: cohortPath(cohort.id, 'settings') },
  ]

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: 'Settings', to: cohortPath(cohort.id, 'settings') }, { label: 'Purchases' }]}
      type={<span>Self-paced course · Purchases</span>}
      title={detail.title}
      titleText={detail.title}
      status={detail.checkout_enabled ? <Badge tone="success">Checkout on</Badge> : <Badge>Checkout off</Badge>}
      context={<>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget>{cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{money(detail.price_cents)}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{plural(counts.paid, 'paid purchase')}</span>
      </>}
      actions={detail.public_slug ? <LinkButton to={`/courses/${detail.public_slug}`} variant="secondary" size="sm"><ExternalLink className="h-4 w-4" aria-hidden="true" />Course page</LinkButton> : null}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={label} />}>
      <Section id="overview" title="Offering">
        <Facts items={[
          { label: 'Price', value: <span className="tabular-nums">{money(detail.price_cents)}</span> },
          { label: 'Paid so far', value: <span className="tabular-nums">{money(detail.paid_cents)} from {plural(counts.paid, 'purchase')}</span> },
          { label: 'Access', value: `${plural(detail.access_months, 'month')} of lessons, ${plural(detail.support_weeks, 'week')} of support` },
          { label: 'Support instructor', value: detail.support_instructor ? <RecordLink record={{ type: 'staff', id: detail.support_instructor.id }} variant="plain">{detail.support_instructor.name}</RecordLink> : 'None' },
          { label: 'Checkouts', value: <span className="tabular-nums">{Object.entries(counts).filter(([, count]) => count > 0).map(([status, count]) => `${count} ${(STATUS[status]?.label || humanize(status)).toLowerCase()}`).join(' · ') || 'None yet'}</span> },
        ]} />
      </Section>

      <Section id="purchases" title="Purchases" count={detail.purchases_count > purchases.rows.length ? `Showing ${purchases.rows.length} of ${detail.purchases_count}` : String(detail.purchases_count)}>
        {purchases.rows.length ? <ul className="divide-y divide-line">
          {purchases.rows.map((purchase) => {
            const status = STATUS[purchase.checkout_state] || { label: humanize(purchase.checkout_state), tone: 'neutral' as BadgeTone }
            return <li key={purchase.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5" data-purchase-row="">
              <div className="min-w-0 flex-1">
                {purchase.enrollment
                  ? <RecordLink record={{ type: 'student', id: purchase.buyer.id, cohortId: cohort.id }} returnLabel={label} variant="plain" touchTarget className="font-semibold">{purchase.buyer.name}</RecordLink>
                  : <span className="font-semibold text-ink">{purchase.buyer.name}</span>}
                <p className="truncate text-xs text-ink-muted" title={purchase.buyer.email}>{purchase.buyer.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-sm tabular-nums text-ink">{money(purchase.price_cents)}</span>
                <span className="text-xs text-ink-muted">{purchase.enrollment ? `Enrolled · ${humanize(purchase.enrollment.status)}` : 'No enrollment'}</span>
                <time dateTime={purchase.created_at} className="text-xs tabular-nums text-ink-muted">{formatShortDateTime(purchase.created_at)}</time>
              </div>
            </li>
          })}
        </ul> : <EmptyRow>No one has bought this course yet.</EmptyRow>}
        {(purchases.next || purchases.error) && purchases.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
            {purchases.error ? <p role="alert" className="text-sm text-danger-ink">{purchases.error}</p> : <span className="text-xs tabular-nums text-ink-muted">Showing {purchases.rows.length} of {detail.purchases_count}</span>}
            {purchases.next && <Button variant="secondary" size="sm" onClick={() => void purchases.loadMore()} disabled={purchases.loading} data-show-more-purchases="">{purchases.loading ? 'Loading…' : purchases.error ? 'Try again' : 'Show more'}</Button>}
          </div>
        )}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}

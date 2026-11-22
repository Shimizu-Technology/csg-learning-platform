import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  Mail,
  RefreshCw,
  Send,
  SkipForward,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { ReleaseCommunications, ReleaseCommunicationsDelivery } from '../../types/api'
import { RecordLink } from '../shared/RecordLink'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'

const DELIVERY_MODE_LABELS: Record<string, string> = {
  program: 'Live program',
  guided: 'Small class',
  self_paced: 'Self-paced',
}

const RELEASE_MODE_LABELS: Record<string, string> = {
  scheduled_daily_unlock: 'Scheduled daily unlock',
  self_paced_open: 'Immediate access (self-paced)',
  personal_pace_open: 'Personal start date',
}

const DELIVERY_STATUS_META: Record<
  ReleaseCommunicationsDelivery['status'],
  { label: string; tone: BadgeTone }
> = {
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
}

function DeliveryStatusIcon({ status }: { status: ReleaseCommunicationsDelivery['status'] }) {
  switch (status) {
    case 'sent':
      return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
    case 'skipped':
      return <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
    case 'pending':
      return <Clock className="h-3.5 w-3.5" aria-hidden="true" />
  }
}

function formatSchoolDate(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatTimestamp(iso: string | null, timeZone: string) {
  if (!iso) return 'Not sent yet'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

function formatUnlockHour(hour: number) {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:00 ${suffix}`
}

export function ReleaseCommunicationsPanel({ cohortId }: { cohortId: number }) {
  const [data, setData] = useState<ReleaseCommunications | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    if (typeof api.getCohortReleaseCommunications !== 'function') {
      setLoading(false)
      return
    }
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const result = await api.getCohortReleaseCommunications(cohortId)
      if (version !== requestVersion.current) return
      if (result.data && !result.error && !result.fromCache) {
        setData(result.data.release_communications)
        setError(null)
      } else {
        setData(null)
        setError(result.error || 'Could not load release communication status.')
      }
    } catch {
      if (version === requestVersion.current) {
        setData(null)
        setError('Could not load release communication status.')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [cohortId])

  useEffect(() => {
    setData(null)
    setPreviewOpen(false)
    void load()
    return () => {
      requestVersion.current += 1
    }
  }, [load])

  const config = data?.configuration
  const recipients = data?.recipients

  const statusBadge = (() => {
    if (!config) return null
    if (!config.daily_unlocks_apply) {
      return { tone: 'neutral' as BadgeTone, label: 'Skipped for this cohort' }
    }
    if (!config.email_configured) {
      return { tone: 'warning' as BadgeTone, label: 'Email not configured' }
    }
    if (config.cohort_status === 'upcoming') {
      return { tone: 'info' as BadgeTone, label: 'Scheduled for launch' }
    }
    return { tone: 'success' as BadgeTone, label: 'Active' }
  })()

  const excludedItems: Array<[string, number]> = recipients
    ? ([
        ['Paused', recipients.excluded.paused],
        ['Dropped', recipients.excluded.dropped],
        ['Invite pending', recipients.excluded.invite_pending],
        ['Expired', recipients.excluded.expired],
        ['Completed', recipients.excluded.completed],
        ['Archived', recipients.excluded.archived_user],
        ['Missing email', recipients.excluded.missing_email],
        ['Opted out', recipients.excluded.opted_out],
        ['Cohort skipped', recipients.excluded.cohort_ineligible],
      ] as Array<[string, number]>).filter(([, count]) => count > 0)
    : []

  return (
    <section
      aria-labelledby={`release-communications-heading-${cohortId}`}
      className="app-surface space-y-5 p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">Lesson releases</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2
              id={`release-communications-heading-${cohortId}`}
              className="flex items-center gap-2 text-lg font-bold text-ink"
            >
              <Mail className="h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" />
              Release communications
            </h2>
            {statusBadge && <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            Verify school timezone, sender identity, upcoming daily unlock emails, and recent delivery receipts.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
          className="w-full shrink-0 sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {loading ? 'Refreshing…' : 'Refresh status'}
        </Button>
      </div>

      {loading && !data ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading release communication status…
        </p>
      ) : error || !data || !config || !recipients ? (
        <div role="alert" className="space-y-3 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-ink">
          <p>{error || 'Could not load release communication status.'}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry status
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-info-line bg-info-soft p-3.5 text-sm text-info-ink">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 leading-6">{config.grade_publication_separation_note}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 rounded-xl border border-line bg-surface-sunken p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                School timezone
              </p>
              <p className="mt-1.5 break-words text-sm font-bold text-ink">
                {config.school_time_zone} ({config.school_time_zone_label})
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                Sends at {formatUnlockHour(config.daily_unlock_hour)} · {config.catch_up_days}-day catch-up cap
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-line bg-surface-sunken p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Send className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Sender identity
              </p>
              <p className="mt-1.5 break-words text-sm font-bold text-ink">
                {config.sender_identity || 'Not configured'}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {config.email_configured ? 'Email provider configured' : 'Set RESEND_API_KEY and sender email'}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-line bg-surface-sunken p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Delivery & release mode
              </p>
              <p className="mt-1.5 text-sm font-bold text-ink">
                Email · {DELIVERY_MODE_LABELS[config.course_delivery] || config.course_delivery}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {RELEASE_MODE_LABELS[config.lesson_release_mode] || config.lesson_release_mode}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-line bg-surface-sunken p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Eligible recipients
              </p>
              <p className="mt-1.5 text-sm font-bold tabular-nums text-ink">
                {recipients.eligible_active_count} of {recipients.total_enrollments} enrolled
              </p>
              <p className="mt-1 break-words text-xs text-ink-secondary">
                {excludedItems.length
                  ? `Excluded: ${excludedItems.map(([label, count]) => `${count} ${label.toLowerCase()}`).join(', ')}`
                  : 'All enrolled learners are eligible'}
              </p>
            </div>
          </div>

          <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-6 text-ink-secondary">
            {config.eligibility_reason}
          </p>

          {config.daily_unlocks_apply && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold text-ink">Upcoming release preview</h3>
                  <p className="text-xs text-ink-secondary">
                    Lessons grouped uniquely by school release day. Deep links target{' '}
                    <span className="break-all font-mono text-ink">{config.frontend_origin}</span>.
                  </p>
                </div>
                {data.sample_preview && (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={previewOpen}
                    onClick={() => setPreviewOpen((open) => !open)}
                    className="w-full shrink-0 sm:w-auto"
                  >
                    {previewOpen ? (
                      <>
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                        Hide sample email
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Preview sample email
                      </>
                    )}
                  </Button>
                )}
              </div>

              {data.upcoming_releases.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-secondary">
                  No upcoming scheduled lesson releases remain for this cohort.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.upcoming_releases.map((release) => (
                    <div
                      key={release.release_date}
                      className="rounded-xl border border-line bg-surface-sunken p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-ink">{formatSchoolDate(release.release_date)}</p>
                          {release.is_today && <Badge tone="info">Today</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                          <span className="tabular-nums">
                            {release.eligible_recipient_count} eligible recipient
                            {release.eligible_recipient_count === 1 ? '' : 's'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {release.lessons.length} lesson{release.lessons.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {release.lessons.map((lesson) => (
                          <li
                            key={lesson.id}
                            className="flex flex-col gap-1 rounded-xl border border-line bg-surface-raised px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="break-words font-semibold text-ink">
                                <RecordLink
                                  record={{ type: 'lesson', id: lesson.id, cohortId }}
                                  variant="plain"
                                >
                                  {lesson.title}
                                </RecordLink>
                              </p>
                              <p className="text-xs text-ink-secondary">
                                <RecordLink
                                  record={{ type: 'module', id: lesson.module_id, cohortId }}
                                  variant="plain"
                                  className="text-xs font-medium text-ink-secondary"
                                >
                                  {lesson.module_name}
                                </RecordLink>{' '}
                                · Day {lesson.release_day + 1}
                              </p>
                            </div>
                            <a
                              href={lesson.deep_link}
                              target="_blank"
                              rel="noreferrer"
                              className="app-link inline-flex min-h-11 items-center gap-1.5 break-all text-xs lg:min-h-9"
                            >
                              <span className="break-all">Open lesson link</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {previewOpen && data.sample_preview && (
                <div
                  aria-label="Sample release email preview"
                  className="space-y-3 rounded-2xl border border-line-strong bg-surface-raised p-4 sm:p-5"
                >
                  <div className="space-y-1 border-b border-line pb-3 text-xs text-ink-secondary">
                    <p className="break-words">
                      <span className="font-semibold text-ink">From:</span>{' '}
                      {data.sample_preview.from || 'Not configured'}
                    </p>
                    <p className="break-words">
                      <span className="font-semibold text-ink">Subject:</span> {data.sample_preview.subject}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Release date:</span>{' '}
                      {formatSchoolDate(data.sample_preview.release_date)}
                    </p>
                  </div>
                  <div className="space-y-3 text-sm">
                    <p className="text-base font-bold text-ink">{data.sample_preview.headline}</p>
                    <p className="text-ink-secondary">{data.sample_preview.intro}</p>
                    <ul className="list-disc space-y-1.5 pl-5 text-ink">
                      {data.sample_preview.lessons.map((lesson) => (
                        <li key={lesson.id} className="break-words">
                          <RecordLink
                            record={{ type: 'lesson', id: lesson.id, cohortId }}
                            variant="plain"
                            className="font-semibold"
                          >
                            {lesson.title}
                          </RecordLink>{' '}
                          <span className="block break-all font-mono text-xs text-ink-muted">{lesson.deep_link}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="rounded-xl border border-line bg-surface-sunken px-3.5 py-2.5 text-xs text-ink-secondary">
                      <span className="font-semibold text-ink">{data.sample_preview.cta_label}:</span>{' '}
                      <span className="break-all font-mono">{data.sample_preview.cta_url}</span>
                    </div>
                    <p className="text-xs text-ink-muted">{data.sample_preview.footer}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-base font-bold text-ink">Recent delivery status</h3>
              {data.scheduler.last_attempted_at && (
                <p className="text-xs text-ink-secondary">
                  Last scheduler check:{' '}
                  {formatTimestamp(data.scheduler.last_attempted_at, config.school_time_zone)}{' '}
                  {config.school_time_zone_label}
                </p>
              )}
            </div>

            {data.recent_deliveries.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-secondary">
                No release email deliveries recorded for this cohort yet.
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-sunken text-xs font-semibold text-ink-muted">
                        <th className="px-4 py-3">Release date</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Recipients</th>
                        <th className="px-4 py-3">Lesson claims</th>
                        <th className="px-4 py-3">Recorded</th>
                        <th className="px-4 py-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.recent_deliveries.map((delivery) => {
                        const meta = DELIVERY_STATUS_META[delivery.status]
                        return (
                          <tr key={`${delivery.date}-${delivery.status}`} className="bg-surface-raised">
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                              {formatSchoolDate(delivery.date)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge tone={meta.tone} icon={<DeliveryStatusIcon status={delivery.status} />}>
                                {meta.label}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">{delivery.recipient_count}</td>
                            <td className="px-4 py-3 tabular-nums text-ink">{delivery.lesson_claim_count}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                              {formatTimestamp(delivery.attempted_at, config.school_time_zone)}
                            </td>
                            <td className="max-w-xs break-words px-4 py-3 text-xs text-ink-secondary">
                              {delivery.error_message ? (
                                <span className="text-danger-ink">{delivery.error_message}</span>
                              ) : (
                                delivery.note || delivery.key
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-2.5 md:hidden">
                  {data.recent_deliveries.map((delivery) => {
                    const meta = DELIVERY_STATUS_META[delivery.status]
                    return (
                      <li
                        key={`${delivery.date}-${delivery.status}`}
                        className="space-y-2 rounded-xl border border-line bg-surface-sunken p-4 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-ink">{formatSchoolDate(delivery.date)}</p>
                          <Badge tone={meta.tone} icon={<DeliveryStatusIcon status={delivery.status} />}>
                            {meta.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                          <span className="tabular-nums">
                            {delivery.recipient_count} recipient{delivery.recipient_count === 1 ? '' : 's'}
                          </span>
                          <span className="tabular-nums">
                            {delivery.lesson_claim_count} lesson claim{delivery.lesson_claim_count === 1 ? '' : 's'}
                          </span>
                          <span>{formatTimestamp(delivery.attempted_at, config.school_time_zone)}</span>
                        </div>
                        {delivery.error_message ? (
                          <p className="break-words text-xs text-danger-ink">{delivery.error_message}</p>
                        ) : delivery.note ? (
                          <p className="break-words text-xs text-ink-secondary">{delivery.note}</p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

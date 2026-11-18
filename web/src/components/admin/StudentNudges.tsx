import { useEffect, useState } from 'react'
import { CalendarClock, History, KeyRound, LifeBuoy, type LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { Button } from '../ui/Button'
import type { LearnerNudge, LearnerNudgesResponse } from '../../types/api'

const guamDate = (value: string) => formatShortDateTime(value, 'Not recorded', 'Pacific/Guam')

const KINDS: Record<LearnerNudge['kind'], { label: string; icon: LucideIcon }> = {
  due_soon: { label: 'Due soon', icon: CalendarClock },
  inactive: { label: 'No recent activity', icon: History },
  support_ending: { label: 'Support ending', icon: LifeBuoy },
  access_ending: { label: 'Access ending', icon: KeyRound },
}

const EMAIL: Record<LearnerNudge['email_status'], string> = {
  sent: 'Email sent',
  failed: 'Email failed',
  not_configured: 'Email not set up',
  no_address: 'No email address',
  not_requested: 'No email',
}

const PUSH: Record<LearnerNudge['push_status'], string> = {
  attempted: 'Push attempted',
  not_sent: 'Push not sent (too late)',
  pending: 'Push pending',
  not_requested: 'No push',
}

const SPANS: Record<string, string> = { '24h': '24 hours', '48h': '48 hours', '1d': '1 day', '3d': '3 days', '7d': '7 days', '14d': '14 days' }

function threshold(nudge: LearnerNudge) {
  const span = SPANS[nudge.threshold] ?? nudge.threshold
  return nudge.kind === 'inactive' ? `After ${span} inactive` : `${span} before`
}

// Reminders the hourly check sent this learner (W9.3). Read-only: what went
// out, when, and whether email and push were attempted and the learner read it.
export function StudentNudges({ enrollmentId }: { enrollmentId: number }) {
  const [data, setData] = useState<LearnerNudgesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void api.getLearnerNudges(enrollmentId).then((result) => {
      if (!active) return
      if (result.data && !result.error) setData(result.data)
      else setError(result.error || 'Could not load reminders.')
    }).catch(() => { if (active) setError('Could not load reminders.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [enrollmentId, version])

  return <section className="app-surface space-y-4 p-5 sm:p-6" aria-labelledby={`nudges-${enrollmentId}`}>
    <div>
      <h2 id={`nudges-${enrollmentId}`} className="text-lg font-bold text-ink">Reminders</h2>
      <p className="mt-1 text-sm text-ink-secondary">Sent by the hourly check, at most one a day unless access is ending. Nothing goes out between 9 pm and 8 am Guam time.</p>
    </div>
    {data && !data.enabled && <p className="text-sm text-ink-secondary">Reminders are off for this cohort. Reminders already sent stay listed.</p>}
    {data?.learner_opted_out && <p className="text-sm text-ink-secondary">This learner turned off optional reminders. Access-ending reminders still go out.</p>}
    {loading && !data && <p role="status" className="text-sm text-ink-muted">Loading reminders…</p>}
    {error && <div className="space-y-2">
      <p role="alert" className="text-sm text-danger-ink">{error}</p>
      <Button variant="secondary" disabled={loading} onClick={() => setVersion((value) => value + 1)}>Reload reminders</Button>
    </div>}
    {data && data.nudges.length === 0 && <p className="text-sm text-ink-secondary">No reminders sent yet.</p>}
    {data && data.nudges.length > 0 && <ul className="space-y-3" aria-label="Reminders sent">
      {data.nudges.map((nudge) => {
        const kind = KINDS[nudge.kind]
        const Icon = kind.icon
        return <li key={nudge.id} className="flex gap-3 rounded-xl border border-line p-3 text-sm text-ink">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink-muted">{kind.label}{nudge.essential ? ' · Essential' : ''} · {threshold(nudge)}</p>
            <p className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{nudge.title}</p>
            {nudge.body && <p className="mt-1 text-ink-secondary [overflow-wrap:anywhere]">{nudge.body}</p>}
            <p className="mt-1 text-xs text-ink-muted">
              Sent {guamDate(nudge.sent_at)} · {EMAIL[nudge.email_status]} · {PUSH[nudge.push_status]} · {nudge.read_at ? `Read ${guamDate(nudge.read_at)}` : 'Not read yet'}
            </p>
          </div>
        </li>
      })}
    </ul>}
  </section>
}

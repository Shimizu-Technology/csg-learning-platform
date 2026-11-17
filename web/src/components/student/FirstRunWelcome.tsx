import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { reviewTiming } from '../../lib/reviewCopy'
import { Button, LinkButton } from '../ui/Button'
import type { DashboardData, StudentToday } from '../../types/api'

/** Reuses #283's enrollment dismissal; the old StartHere is never mounted here. */
export function FirstRunWelcome({ data, today, lessonPath, learnPath, onDismiss }: { data: DashboardData; today: StudentToday; lessonPath: string | null; learnPath: string; onDismiss: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function dismiss() {
    if (!data.cohort || saving) return
    setSaving(true); setError('')
    try {
      const response = await api.dismissStartHere(data.cohort.id)
      if (response.data?.dismissed && !response.error) onDismiss()
      else setError('Could not save. Try again; your lessons are ready below.')
    } catch { setError('Could not save. Try again; your lessons are ready below.') }
    finally { setSaving(false) }
  }
  const next = today.next_lesson
  return <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="welcome-title">
    <p className="text-xs font-semibold text-primary-ink">Start here</p>
    <h2 id="welcome-title" className="mt-1 text-xl font-bold text-ink">Here’s how your course works</h2>
    <ol className="mt-4 divide-y divide-line border-t border-line">
      <Step number={1} title={today.mode === 'self_paced' ? 'Learn at your own pace' : 'Follow the class schedule'}>
        {today.mode === 'self_paced' ? 'Read or watch lessons, try the exercises, and submit your work. There are no class times or deadlines.' : 'Learn has your lessons and release dates. Today shows your next step and work that needs you.'}
      </Step>
      <Step number={2} title="Your instructor reviews your exercises">
        {today.reviewer?.full_name ?? 'Your instructor'} reviews your exercises, {reviewTiming(data.review_response_time)}.
        {today.support.mode !== 'none' && ' Stuck? Use Ask for help on the lesson.'}
        {today.support.ends_on && <> {today.support.ended ? 'Support ended on' : 'Support until'} <strong>{formatShortDate(today.support.ends_on)}</strong>.</>}
      </Step>
      <Step number={3} title={next ? `Start with ${next.title}` : 'Explore Learn'}>Get to know lessons, submitting work, and getting help.</Step>
    </ol>
    <div className="mt-4 flex flex-wrap gap-2">
      {next && lessonPath && <LinkButton to={lessonPath} state={{ returnTo: `/dashboard?cohort_id=${data.cohort!.id}`, returnLabel: 'Today' }} className="max-w-full"><span className="min-w-0 [overflow-wrap:anywhere]">Start {next.title}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></LinkButton>}
      <LinkButton to={learnPath} variant={next ? 'quiet' : 'primary'}>See all lessons</LinkButton>
      <Button variant="quiet" disabled={saving} onClick={() => void dismiss()}>{saving ? 'Saving…' : 'Dismiss welcome'}</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
  </article>
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <li className="flex gap-3 py-3"><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-ink">{number}</span><div className="min-w-0"><h3 className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{title}</h3><p className="mt-1 text-sm leading-6 text-ink-secondary">{children}</p></div></li>
}

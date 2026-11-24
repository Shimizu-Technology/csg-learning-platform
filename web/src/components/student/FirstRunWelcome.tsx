import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { reviewTiming } from '../../lib/reviewCopy'
import { Button, LinkButton } from '../ui/Button'
import type { DashboardData, StudentToday } from '../../types/api'

/** Reuses #283's enrollment dismissal; the old StartHere is never mounted here. */
export function FirstRunWelcome({ data, today, lessonPath, learnPath, onDismiss }: { data: DashboardData; today: StudentToday; lessonPath: string | null; learnPath: string; onDismiss: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { enrollments } = useAuthContext()
  const cohortId = data.cohort?.id
  const enrollmentId = enrollments?.find((item) => item.cohort.id === cohortId)?.id
  const modules = data.modules ?? []
  const githubModuleIds = modules.filter((item) => data.cohort?.requires_github || item.module_type === 'prework').map((item) => item.id).join(',')
  const showGithubSetup = Boolean(enrollmentId && data.cohort?.features?.github_app && data.cohort.features.github_sync !== false && (data.cohort.requires_github || githubModuleIds))
  const [githubSetupNeeded, setGithubSetupNeeded] = useState(false)
  useEffect(() => {
    if (!showGithubSetup || !enrollmentId) return
    let current = true
    void api.getGithubRepositoryBindings(enrollmentId).then(({ data: setup }) => {
      if (!current || !setup) return
      const verified = (moduleId: number | null) => {
        const binding = setup.bindings.find((item) => item.curriculum_module_id === moduleId)
          ?? setup.bindings.find((item) => item.curriculum_module_id === null)
        return binding?.verification_state === 'verified' && binding.verified_at && binding.repository_id
          && setup.installations.some((installation) => installation.id === binding.github_app_installation_id)
      }
      const moduleIds = githubModuleIds ? githubModuleIds.split(',').map(Number) : [null]
      setGithubSetupNeeded(!setup.github_identity.id || moduleIds.some((id) => !verified(id)))
    }).catch(() => { /* An unavailable check leaves the welcome usable. */ })
    return () => { current = false }
  }, [enrollmentId, githubModuleIds, showGithubSetup])

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
  // Only advertise choosing a pace when the learner can choose one (no staff plan in its place).
  const choosesPace = Boolean(today.personal_pace?.available) && today.personal_pace?.status !== 'staff_plan'
  // A pace chosen before staff turned pace off stays, read-only, with its targets and firm date.
  const keptPace = !choosesPace && today.personal_pace?.plan_source === 'learner_pace' && today.personal_pace.weeks !== null
  const hasSubmissionWindows = Boolean(
    today.next_lesson?.submission_window?.submissions_close_at
    || data.modules?.some((mod) => mod.lessons.some((lesson) => Boolean(lesson.submission_window?.submissions_close_at))),
  )
  return <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="welcome-title">
    <p className="text-xs font-semibold text-primary-ink">Start here</p>
    <h2 id="welcome-title" className="mt-1 text-xl font-bold text-ink">Here’s how your course works</h2>
    <ol className="mt-4 divide-y divide-line border-t border-line">
      <Step number={1} title={choosesPace ? 'Learn at the pace you choose' : keptPace ? 'Keep to your pace' : today.mode === 'self_paced' ? 'Learn at your own pace' : 'Follow the class schedule'}>
        {choosesPace
          ? 'Every lesson is open, unless your instructor schedules one later. Your pace sets a target for each week, and Today shows how you’re doing. Only the final project has a firm date.'
          : keptPace
            ? 'Your plan keeps its weekly targets and one firm final-project date, shown on Today. Your instructor can change it.'
          : today.mode === 'self_paced'
            ? hasSubmissionWindows
              ? 'Read or watch lessons, try the exercises, and submit your work. There are no live class times; check Learn and each lesson for submission deadlines.'
              : 'Read or watch lessons, try the exercises, and submit your work. There are no live class times; if a lesson has a submission deadline, you’ll see it in Learn and on the lesson.'
            : 'Learn has your lessons and release dates. Today shows your next step and work that needs you.'}
      </Step>
      <Step number={2} title="Your instructor reviews your exercises">
        {today.reviewer?.full_name ?? 'Your instructor'} reviews your exercises, {reviewTiming(data.review_response_time)}.
        {today.support.mode !== 'none' && ' Stuck? Use Ask for help on the lesson.'}
        {today.support.ends_on && <> {today.support.ended ? 'Support ended on' : 'Support until'} <strong>{formatShortDate(today.support.ends_on)}</strong>.</>}
      </Step>
      {githubSetupNeeded && data.cohort && <Step number={3} title="Connect GitHub">
        Connect your account and verify your repository so Learn can receive your exercises.{' '}
        <LinkButton variant="secondary" to={`/profile#github-repository-${data.cohort.id}`}>Connect GitHub</LinkButton>
      </Step>}
      <Step number={githubSetupNeeded && data.cohort ? 4 : 3} title={next ? `Start with ${next.title}` : 'Explore Learn'}>Get to know lessons, submitting work, and getting help.</Step>
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

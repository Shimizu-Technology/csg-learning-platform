import { useEffect, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { History, Settings2 } from 'lucide-react'
import { api, type FeatureSettingsData } from '../../lib/api'
import { humanize } from '../../lib/glossary'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ReviewResponseSettings } from './ReviewResponseSettings'

// A cohort gets these only by turning them on itself (FeatureSwitches::COHORT_OPT_IN).
export const COHORT_OPT_IN_SWITCHES = new Set([
  'github_app',
  'github_webhooks',
  'github_reconciliation',
  'github_issue_delivery_v2',
  'github_grade_suggestions',
  'self_paced_peer_space',
  'learner_nudges',
  'certificates',
])

export interface FeatureSwitchInfo {
  label: string
  description: string
}

export const FEATURE_SWITCH_GROUPS: Array<{
  title: string
  description: string
  keys: string[]
}> = [
  {
    title: 'Sessions and recordings',
    description: 'Live meetings, office hours, and recorded class replays.',
    keys: ['private_meetings', 'office_hours', 'recordings'],
  },
  {
    title: 'Communication and support',
    description: 'Class chat, course community, updates, help requests, and follow-up plans.',
    keys: ['class_channels', 'self_paced_peer_space', 'announcements', 'help_requests', 'interventions'],
  },
  {
    title: 'Learning experience and completion',
    description: 'Checkpoints, pacing plans, the student’s page layout, reminders, and certificates.',
    keys: ['knowledge_checks', 'learning_plans', 'student_experience_v2', 'learner_nudges', 'certificates'],
  },
  {
    title: 'GitHub and automated checks',
    description: 'Repository syncing, GitHub App permissions, webhooks, Redo issues, and grade suggestions.',
    keys: [
      'github_sync',
      'github_app',
      'github_webhooks',
      'github_reconciliation',
      'github_issue_delivery_v2',
      'github_grade_suggestions',
    ],
  },
]

export const FEATURE_SWITCH_META: Record<string, FeatureSwitchInfo> = {
  private_meetings: {
    label: 'Meetings',
    description: 'Lets learners book 1-on-1 meetings with staff during configured availability slots.',
  },
  office_hours: {
    label: 'Office hours',
    description: 'Shows scheduled live class and office-hour sessions on cohort calendars and Today.',
  },
  recordings: {
    label: 'Recordings',
    description: 'Shows class video replays and watch progress in the cohort Recordings library.',
  },
  class_channels: {
    label: 'Class chat',
    description: 'Enables class chat and direct messages between learners and teaching staff.',
  },
  self_paced_peer_space: {
    label: 'Course community (self-paced)',
    description: 'Lets self-paced learners talk in class chat. Recommended when 5 or more learners are enrolled.',
  },
  knowledge_checks: {
    label: 'Checkpoints',
    description: 'Shows interactive quick-check questions with instant feedback inside lessons.',
  },
  help_requests: {
    label: 'Help requests',
    description: 'Lets learners ask lesson-specific questions that route to staff Support.',
  },
  github_sync: {
    label: 'GitHub sync and checks',
    description: 'Lets staff sync exercise submissions from student GitHub repositories and view check results.',
  },
  github_app: {
    label: 'GitHub App access',
    description: 'Verifies learner GitHub accounts and personal repositories through the installed GitHub App.',
  },
  github_webhooks: {
    label: 'GitHub webhooks',
    description: 'Receives live push and check-run updates from GitHub without waiting for a manual sync. Needs GitHub App access.',
  },
  github_reconciliation: {
    label: 'Hourly GitHub reconciliation',
    description: 'Runs an hourly background sync to catch missed commits or checks from verified repositories. Needs GitHub App access.',
  },
  github_issue_delivery_v2: {
    label: 'Reliable GitHub Redo issues',
    description: 'Posts and retries Redo feedback on the learner’s GitHub repository through a durable delivery queue. Needs GitHub App access.',
  },
  github_grade_suggestions: {
    label: 'GitHub grade suggestions',
    description: 'Suggests a grade in Grading based on each exercise’s configured check rules. Instructors always make the final grade decision.',
  },
  announcements: {
    label: 'Updates',
    description: 'Lets staff post school-wide or cohort-wide updates that appear in learners’ Updates feed.',
  },
  interventions: {
    label: 'Follow-up plans',
    description: 'Lets staff track follow-up plans and return plans for learners who fall behind or pause.',
  },
  learning_plans: {
    label: 'Learning plans',
    description: 'Enables milestone plans and learner-chosen weekly pace targets. Required when learner-chosen pace is on.',
  },
  student_experience_v2: {
    label: 'New student experience',
    description: 'Uses the streamlined Today, Learn outline, and My work layout for learners.',
  },
  learner_nudges: {
    label: 'Learner reminders',
    description: 'Sends gentle scheduled reminders when learners have upcoming targets or quiet streaks.',
  },
  certificates: {
    label: 'Certificates',
    description: 'Issues verifiable completion certificates after learners finish all required lessons and graded projects.',
  },
}

export function featureSwitchLabel(key: string): string {
  if (key === 'public_catalog_mode') return 'Public course catalog link'
  if (key === 'review_response_time') return 'Typical review response time'
  return FEATURE_SWITCH_META[key]?.label || humanize(key)
}

export function resolveEffectiveSwitchState({
  key,
  cohortId,
  value,
  schoolDefault,
}: {
  key: string
  cohortId?: number
  value: boolean | null | undefined
  schoolDefault: boolean
}): { label: string; tone: BadgeTone; effectiveOn: boolean; extraBadge?: { label: string; tone: BadgeTone } } {
  const optIn = COHORT_OPT_IN_SWITCHES.has(key)

  if (!cohortId) {
    const on = value === true
    return {
      label: on ? 'On' : 'Off',
      tone: on ? 'success' : 'neutral',
      effectiveOn: on,
      extraBadge: optIn ? { label: 'Cohort opt-in', tone: 'info' } : undefined,
    }
  }

  if (optIn) {
    if (!schoolDefault) {
      return {
        label: 'Needs school switch',
        tone: value === true ? 'warning' : 'neutral',
        effectiveOn: false,
      }
    }
    if (value === true) {
      return { label: 'On', tone: 'success', effectiveOn: true }
    }
    if (value == null) {
      return {
        label: 'Off',
        tone: 'neutral',
        effectiveOn: false,
        extraBadge: { label: 'Cohort opt-in', tone: 'info' },
      }
    }
    return { label: 'Off', tone: 'neutral', effectiveOn: false }
  }

  const effectiveOn = value == null ? schoolDefault : value === true
  return {
    label: effectiveOn ? 'On' : 'Off',
    tone: effectiveOn ? 'success' : 'neutral',
    effectiveOn,
  }
}

function SafeLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  const inRouter = useInRouterContext()
  if (inRouter) {
    return <Link to={to} className={className}>{children}</Link>
  }
  return <a href={to} className={className}>{children}</a>
}

export function FeatureSettings({
  cohortId,
  onDraftChange,
  showReviewResponse = true,
  onEffectiveChange,
}: {
  cohortId?: number
  onDraftChange?: (values: Record<string, boolean | null> | null) => void
  showReviewResponse?: boolean
  onEffectiveChange?: (effective: Record<string, boolean>) => void
}) {
  const [data, setData] = useState<FeatureSettingsData | null>(null)
  const [values, setValues] = useState<Record<string, boolean | null>>({})
  const [mode, setMode] = useState('automatic')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => api.getFeatureSettings(cohortId)).then((result) => {
      if (!active) return
      if (!result.data) {
        setMessage('Could not load features. Reload to try again.')
        return
      }
      setData(result.data)
      setValues(
        Object.fromEntries(
          Object.entries(cohortId ? result.data.overrides : result.data.features).filter(
            ([key]) => key in FEATURE_SWITCH_META,
          ),
        ),
      )
      setMode(result.data.public_catalog_mode)
    }).catch(() => {
      if (active) setMessage('Could not load features. Reload to try again.')
    })
    return () => { active = false }
  }, [cohortId])

  useEffect(() => {
    if (!data) return
    if (onDraftChange) {
      const saved = cohortId ? data.overrides : data.features
      onDraftChange(
        Object.entries(values).some(([key, value]) => (saved[key] ?? null) !== value) ? values : null,
      )
    }
    if (onEffectiveChange) {
      const next: Record<string, boolean> = {}
      for (const key of Object.keys(FEATURE_SWITCH_META)) {
        next[key] = resolveEffectiveSwitchState({
          key,
          cohortId,
          value: values[key],
          schoolDefault: Boolean(data.defaults[key]),
        }).effectiveOn
      }
      onEffectiveChange(next)
    }
  }, [data, values, cohortId, onDraftChange, onEffectiveChange])

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const result = await api.saveFeatureSettings(
        { features: values, ...(!cohortId ? { public_catalog_mode: mode } : {}) },
        cohortId,
      )
      if (result.data) {
        setData(result.data)
        setMessage('Features saved. Changes appear when learners refresh.')
      } else {
        setMessage('Could not save features. Your choices are preserved; try again.')
      }
    } catch {
      setMessage('Could not save features. Your choices are preserved; try again.')
    } finally {
      setSaving(false)
    }
  }

  const changesHref = cohortId ? `/admin/settings?tab=changes&cohort_id=${cohortId}` : '/admin/settings?tab=changes'

  return (
    <section className="app-surface space-y-5 p-5" aria-label={cohortId ? 'Cohort features' : 'School features'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-bold text-ink">Features</h2>
          <p className="text-sm text-ink-secondary">
            {cohortId
              ? 'Inherit school defaults or choose a different setting for this cohort.'
              : 'School defaults apply unless a cohort overrides them.'}{' '}
            Turning a feature off preserves its saved data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {cohortId && (
            <SafeLink
              to="/admin/settings"
              className="app-link inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
            >
              <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              School defaults
            </SafeLink>
          )}
          <SafeLink
            to={changesHref}
            className="app-link inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
          >
            <History className="h-4 w-4 shrink-0" aria-hidden="true" />
            View changes
          </SafeLink>
        </div>
      </div>

      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-xs leading-5 text-ink-secondary">
        Switches marked <strong>Cohort opt-in</strong> stay Off by default on each cohort until both the school switch
        and that cohort are turned On.
      </p>

      {data && (
        <>
          <div className="space-y-6">
            {FEATURE_SWITCH_GROUPS.map((group) => (
              <div key={group.title} className="space-y-3">
                <div className="border-b border-line pb-2">
                  <h3 className="text-sm font-bold text-ink">{group.title}</h3>
                  <p className="text-xs text-ink-muted">{group.description}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {group.keys.map((key) => {
                    const meta = FEATURE_SWITCH_META[key]
                    const descriptionId = `feature-help-${key}`
                    const schoolOn = Boolean(data.defaults[key])
                    const state = resolveEffectiveSwitchState({
                      key,
                      cohortId,
                      value: values[key],
                      schoolDefault: schoolOn,
                    })
                    return (
                      <label
                        key={key}
                        className="flex flex-col gap-2 rounded-xl border border-line bg-surface-sunken/50 p-3.5 text-sm font-semibold text-ink"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span>{meta.label}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={state.tone}>{state.label}</Badge>
                            {state.extraBadge && (
                              <Badge tone={state.extraBadge.tone}>{state.extraBadge.label}</Badge>
                            )}
                          </span>
                        </span>
                        <select
                          disabled={saving}
                          aria-describedby={descriptionId}
                          className="min-h-11 rounded-xl border border-line bg-surface-raised px-3 font-normal text-ink"
                          value={values[key] == null ? 'inherit' : values[key] ? 'on' : 'off'}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              [key]: e.target.value === 'inherit' ? null : e.target.value === 'on',
                            }))
                          }
                        >
                          {cohortId && (
                            <option value="inherit">
                              Inherit → {COHORT_OPT_IN_SWITCHES.has(key) ? 'Off' : schoolOn ? 'On' : 'Off'}
                            </option>
                          )}
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                        <span id={descriptionId} className="text-xs font-normal leading-5 text-ink-secondary">
                          {meta.description}
                          {cohortId && COHORT_OPT_IN_SWITCHES.has(key) && !schoolOn && (
                            <> Turn on at the school level first so this cohort can use it.</>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {!cohortId && (
            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-sunken/50 p-3.5 text-sm font-semibold text-ink">
              Public course catalog link
              <select
                disabled={saving}
                className="min-h-11 rounded-xl border border-line bg-surface-raised px-3 font-normal text-ink"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="automatic">Automatic (show when at least one paid course is public)</option>
                <option value="always">Always show</option>
                <option value="hidden">Hidden</option>
              </select>
              <span className="text-xs font-normal text-ink-secondary">
                Controls whether the public Courses catalog link appears on the sign-in and home pages.
              </span>
            </label>
          )}

          {!onDraftChange && (
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save features'}
            </Button>
          )}
        </>
      )}

      {showReviewResponse && <ReviewResponseSettings key={cohortId || 'school'} cohortId={cohortId} />}
      {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
    </section>
  )
}

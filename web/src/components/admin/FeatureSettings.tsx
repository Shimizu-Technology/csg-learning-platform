import { ReviewResponseSettings } from './ReviewResponseSettings'
import { useEffect, useState } from 'react'
import { api, type FeatureSettingsData } from '../../lib/api'
import { Button } from '../ui/Button'

// A cohort gets these only by turning them on itself (FeatureSwitches::COHORT_OPT_IN).
const cohortOptIn = new Set(['github_app', 'github_webhooks', 'self_paced_peer_space', 'learner_nudges', 'certificates'])
const labels: Record<string, string> = { private_meetings: 'Meetings', office_hours: 'Office hours', recordings: 'Recordings', class_channels: 'Class chat', self_paced_peer_space: 'Course community (self-paced)', knowledge_checks: 'Checkpoints', help_requests: 'Help requests', github_sync: 'GitHub sync and checks', github_app: 'GitHub App access', github_webhooks: 'GitHub webhooks', announcements: 'Updates', interventions: 'Follow-up plans', learning_plans: 'Learning plans', student_experience_v2: 'New student experience', learner_nudges: 'Learner reminders', certificates: 'Certificates' }
const descriptions: Partial<Record<string, string>> = {
  self_paced_peer_space: 'Lets self-paced learners talk in class chat. Recommended when 5 or more learners are enrolled.',
}
export function FeatureSettings({ cohortId, onDraftChange, showReviewResponse = true }: {
  cohortId?: number
  onDraftChange?: (values: Record<string, boolean | null> | null) => void
  showReviewResponse?: boolean
}) {
  const [data, setData] = useState<FeatureSettingsData | null>(null)
  const [values, setValues] = useState<Record<string, boolean | null>>({})
  const [mode, setMode] = useState('automatic')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => api.getFeatureSettings(cohortId)).then(result => {
      if (!active) return
      if (!result.data) { setMessage('Could not load features. Reload to try again.'); return }
      setData(result.data); setValues(Object.fromEntries(Object.entries(cohortId ? result.data.overrides : result.data.features).filter(([key]) => key in labels))); setMode(result.data.public_catalog_mode)
    }).catch(() => { if (active) setMessage('Could not load features. Reload to try again.') })
    return () => { active = false }
  }, [cohortId])
  useEffect(() => {
    if (!data || !onDraftChange) return
    const saved = cohortId ? data.overrides : data.features
    onDraftChange(Object.entries(values).some(([key, value]) => (saved[key] ?? null) !== value) ? values : null)
  }, [data, values, cohortId, onDraftChange])
  async function save() {
    setSaving(true); setMessage('')
    try {
      const result = await api.saveFeatureSettings({ features: values, ...(!cohortId ? { public_catalog_mode: mode } : {}) }, cohortId)
      if (result.data) { setData(result.data); setMessage('Features saved. Changes appear when learners refresh.') }
      else setMessage('Could not save features. Your choices are preserved; try again.')
    } catch { setMessage('Could not save features. Your choices are preserved; try again.') }
    finally { setSaving(false) }
  }
  return <section className="app-surface space-y-4 p-5" aria-label={cohortId ? 'Cohort features' : 'School features'}>
    <h2 className="text-lg font-bold text-ink">Features</h2>
    <p className="text-sm text-ink-secondary">{cohortId ? 'Inherit school defaults or choose a different setting for this cohort.' : 'School defaults apply unless a cohort overrides them.'} Turning a feature off preserves its saved data.</p><p className="text-sm text-ink-secondary">GitHub App access, GitHub webhooks, Course community (self-paced), Learner reminders, and Certificates require the school switch and an explicit On setting for this cohort. Inherit keeps them off.</p>
    {data && <><div className="grid gap-4 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => {
      const description = descriptions[key]
      const descriptionId = description ? `feature-help-${key}` : undefined
      return <label key={key} className="flex flex-col gap-1 text-sm font-semibold text-ink">{label}<select disabled={saving} aria-describedby={descriptionId} className="min-h-11 rounded-xl border border-line bg-surface-raised px-3" value={values[key] == null ? 'inherit' : values[key] ? 'on' : 'off'} onChange={e => setValues(v => ({ ...v, [key]: e.target.value === 'inherit' ? null : e.target.value === 'on' }))}>
        {cohortId && <option value="inherit">Inherit → {cohortOptIn.has(key) ? 'Off' : data.defaults[key] ? 'On' : 'Off'}</option>}<option value="on">On</option><option value="off">Off</option>
      </select>{description && <span id={descriptionId} className="text-xs font-normal text-ink-secondary">{description}</span>}</label>
    })}</div>
    {!cohortId && <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Public course catalog link<select disabled={saving} className="min-h-11 rounded-xl border border-line bg-surface-raised px-3" value={mode} onChange={e => setMode(e.target.value)}><option value="automatic">Automatic</option><option value="always">Always show</option><option value="hidden">Hidden</option></select></label>}
    {!onDraftChange && <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save features'}</Button>}</>}
    {showReviewResponse && <ReviewResponseSettings key={cohortId || "school"} cohortId={cohortId} />}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}

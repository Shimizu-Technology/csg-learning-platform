import { useEffect, useState } from 'react'
import { api, type FeatureSettingsData } from '../../lib/api'
import { Button } from '../ui/Button'

const labels: Record<string, string> = { private_meetings: 'Private meetings', office_hours: 'Office hours', recordings: 'Recordings', class_channels: 'Class channels', course_community: 'Course community', knowledge_checks: 'Knowledge checks', help_requests: 'Help requests', github_sync: 'GitHub sync and checks', announcements: 'Announcements', interventions: 'Follow-up plans', learning_plans: 'Learning plans' }
export function FeatureSettings({ cohortId }: { cohortId?: number }) {
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
      setData(result.data); setValues(cohortId ? result.data.overrides : result.data.features); setMode(result.data.public_catalog_mode)
    }).catch(() => { if (active) setMessage('Could not load features. Reload to try again.') })
    return () => { active = false }
  }, [cohortId])
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
    <p className="text-sm text-ink-secondary">{cohortId ? 'Inherit school defaults or choose a different setting for this cohort.' : 'School defaults apply unless a cohort overrides them.'} Turning a feature off preserves its saved data.</p>
    {data && <><div className="grid gap-4 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-sm font-semibold text-ink">{label}<select disabled={saving} className="min-h-11 rounded-xl border border-line bg-surface-raised px-3" value={values[key] == null ? 'inherit' : values[key] ? 'on' : 'off'} onChange={e => setValues(v => ({ ...v, [key]: e.target.value === 'inherit' ? null : e.target.value === 'on' }))}>
      {cohortId && <option value="inherit">Inherit ({data.defaults[key] ? 'On' : 'Off'})</option>}<option value="on">On</option><option value="off">Off</option>
    </select></label>)}</div>
    {!cohortId && <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Public course catalog link<select disabled={saving} className="min-h-11 rounded-xl border border-line bg-surface-raised px-3" value={mode} onChange={e => setMode(e.target.value)}><option value="automatic">Automatic</option><option value="always">Always show</option><option value="hidden">Hidden</option></select></label>}
    <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save features'}</Button></>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}

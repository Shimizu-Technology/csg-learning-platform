import { useState } from 'react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'
import type { DashboardData } from '../../types/api'

export function StartHere({ data, onDismiss }: { data: DashboardData; onDismiss: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function dismiss() {
    if (!data.cohort) return
    setSaving(true); setError('')
    try {
      const r = await api.dismissStartHere(data.cohort.id)
      if (r.data?.dismissed && !r.error) onDismiss()
      else setError('Could not save. Try again; your course is ready below.')
    } catch { setError('Could not save. Try again; your course is ready below.') }
    finally { setSaving(false) }
  }
  return <section className="rounded-2xl border border-line bg-surface-raised p-5" aria-labelledby="start-here-title">
    <h2 id="start-here-title" className="text-xl font-bold">Start here</h2>
    <p className="mt-3 text-sm leading-7 text-ink-secondary">Work through Learn at your own pace. Read or watch each lesson, try the exercises, and submit your work. Your instructor will review it. Typical response time: {data.review_response_time || 'usually reviewed within 2 days'}.</p>
    <p className="mt-2 text-sm leading-7 text-ink-secondary">Your help period lasts {data.course_access?.support_weeks ?? 6} weeks from your first course open{data.course_access?.support_expires_at ? `, until ${new Date(data.course_access.support_expires_at).toLocaleDateString()}` : ''}. Use Ask for help on a lesson to explain what you tried and where you got stuck.</p>

    <div className="mt-4"><Button disabled={saving} onClick={() => void dismiss()}>{saving ? 'Saving…' : 'Got it, let’s start'}</Button></div>
    {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
  </section>
}

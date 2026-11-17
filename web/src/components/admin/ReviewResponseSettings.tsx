import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'

export type SavedReviewResponse = { cohortId: number; value: string | null }

export function ReviewResponseSettings({ cohortId, onDraftChange, savedResponse }: { cohortId?: number; onDraftChange?: (value: string | null | undefined) => void; savedResponse?: SavedReviewResponse }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [fallback, setFallback] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    api.getFeatureSettings(cohortId).then(r => {
      if (!active) return
      if (!r.data || r.error || r.fromCache) { setMessage('Could not load the response time. Reload to try again.'); return }
      setValue(cohortId ? r.data.review_response_time_override || '' : r.data.review_response_time || '')
      setSaved(cohortId ? r.data.review_response_time_override || '' : r.data.review_response_time || '')
      setFallback(r.data.review_response_time_default || 'usually reviewed within 2 days'); setLoaded(true)
    }).catch(() => { if (active) setMessage('Could not load the response time. Reload to try again.') })
    return () => { active = false }
  }, [cohortId])
  useEffect(() => {
    if (loaded && savedResponse && savedResponse.cohortId === cohortId) setSaved(savedResponse.value || '')
  }, [cohortId, loaded, savedResponse])
  useEffect(() => {
    if (loaded && onDraftChange) onDraftChange(value.trim() === saved.trim() ? undefined : value.trim() || null)
  }, [loaded, value, saved, onDraftChange])
  async function save() {
    setSaving(true); setMessage('')
    try {
      const r = await api.saveFeatureSettings({ review_response_time: value.trim() || null }, cohortId)
      if (r.data && !r.error) setSaved(value.trim())
      setMessage(r.error ? 'Could not save the response time. Try again.' : 'Response time saved.')
    } catch { setMessage('Could not save the response time. Try again.') }
    finally { setSaving(false) }
  }
  return <section className="mt-5 space-y-3 border-t border-line pt-5" aria-label="Review response time">
    <label className="block text-sm font-semibold">Typical response time<input className="app-control mt-2 w-full" maxLength={200} value={value} disabled={!loaded || saving} onChange={e => setValue(e.target.value)} placeholder={fallback} /></label>
    <p className="text-sm text-ink-secondary">{cohortId ? `Leave blank to inherit the school default: ${fallback}.` : 'Learners see this while waiting for instructor review. Cohorts can override this default.'}</p>
    {!onDraftChange && <Button disabled={!loaded || saving || (!cohortId && !value.trim())} variant="secondary" onClick={() => void save()}>{saving ? 'Saving…' : 'Save response time'}</Button>}
    <p className="text-sm text-ink-muted">Write a review expectation, for example “usually reviewed within 2 days”. Learners will see “Your instructor will review it — usually within 2 days.”</p>
    {onDraftChange && <p className="text-sm text-ink-secondary">Use Save settings below to save this response time with your other changes.</p>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}

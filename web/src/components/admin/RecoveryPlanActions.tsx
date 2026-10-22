import { useState } from 'react'
import { api } from '../../lib/api'
import type { RecoveryPlan } from '../../types/api'
import { Button } from '../ui/Button'

export function RecoveryPlanActions({ plan, onSaved }: { plan: RecoveryPlan; onSaved: (plan: RecoveryPlan) => void }) {
  const [body, setBody] = useState('')
  const [outcome, setOutcome] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  async function save(event: React.FormEvent, complete: boolean) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(null)
    const result = complete
      ? await api.updateRecoveryPlan(plan.id, { status: 'completed', outcome: outcome.trim() })
      : await api.createRecoveryPlanCheckIn(plan.id, { body: body.trim() })
    setSaving(false)
    if (!result.data) { setError(result.error || 'Could not save this recovery plan. Try again.'); return }
    setBody('')
    setSaved(complete ? 'Outcome recorded. Plan completed.' : 'Check-in saved. Next check-in scheduled.')
    onSaved(result.data.recovery_plan)
  }
  return <div className="mt-5 space-y-4 border-t border-line pt-4">
    {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
    {saved && <p role="status" className="text-sm text-success-700">{saved}</p>}
    {plan.status === 'active' && <>
      <form onSubmit={(event) => void save(event, false)} className="space-y-3">
        <label className="block text-sm font-semibold text-ink">Record check-in<textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={4000} rows={3} className="app-control mt-2 w-full font-normal" /></label>
        <Button type="submit" disabled={saving || !body.trim()}>Save check-in</Button>
      </form>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">Record outcome and complete plan</summary>
        <form onSubmit={(event) => void save(event, true)} className="space-y-3">
          <label className="block text-sm font-semibold text-ink">Outcome<textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} required maxLength={2000} rows={3} className="app-control mt-2 w-full font-normal" /></label>
          <Button type="submit" disabled={saving || !outcome.trim()}>Complete recovery plan</Button>
        </form>
      </details>
    </>}
  </div>
}

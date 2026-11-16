import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { api } from '../../lib/api'
import { interventionPath } from '../../lib/routes'
import { schoolTimeGenericLabel, schoolWallTimeToIso } from '../../lib/schoolTime'
import { useConfirm } from '../../contexts/ConfirmContext'
import { Modal } from '../shared/Modal'
import { UnsavedChangesGuard } from '../shared/UnsavedChangesGuard'
import { Button, LinkButton } from '../ui/Button'

export function StartFollowUpPlan({ enrollmentId, studentName, returnTo, activePlanId }: { activePlanId?: number | null; enrollmentId: number; studentName: string; returnTo: string }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = open && Boolean(summary || followUp)
  async function close() {
    if (saving || (dirty && !await confirm({ title: 'Discard follow-up draft?', description: 'The next step and follow-up date have not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return
    setOpen(false); setSummary(''); setFollowUp(''); setError(null)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = schoolWallTimeToIso(followUp)
    if (!summary.trim() || !next || saving) return
    setSaving(true); setError(null)
    try {
      const result = await api.createIntervention({ enrollment_id: enrollmentId, trigger_type: 'manual', severity: 'normal', action_summary: summary.trim(), next_follow_up_at: next })
      if (!result.data) { setError(result.error || 'Could not start the follow-up plan.'); return }
      setOpen(false); setSummary(''); setFollowUp('')
      navigate(interventionPath(result.data.intervention.id, returnTo), { state: { returnTo, returnLabel: studentName } })
    } catch { setError('Could not start the follow-up plan. Your draft is still here. Try again.') }
    finally { setSaving(false) }
  }
  if (activePlanId) return <LinkButton size="sm" variant="secondary" to={interventionPath(activePlanId, returnTo)}><Flag className="h-4 w-4" aria-hidden="true" />Open follow-up plan</LinkButton>
  return <>
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Flag className="h-4 w-4" aria-hidden="true" />Start follow-up plan</Button>
    <UnsavedChangesGuard dirty={dirty && !saving} />
    <Modal open={open} onClose={() => void close()} title="Start follow-up plan" subtitle={studentName}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold">Next step<textarea required maxLength={2000} rows={4} className="app-control mt-2 w-full" value={summary} onChange={event => setSummary(event.target.value)} disabled={saving} /></label>
        <label className="block text-sm font-semibold">Next follow-up ({schoolTimeGenericLabel()})<input required type="datetime-local" className="app-control mt-2 w-full" value={followUp} onChange={event => setFollowUp(event.target.value)} disabled={saving} /></label>
        <p className="text-sm text-ink-secondary">You will own this plan. Only staff can see the next step and follow-up date.</p>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || !summary.trim() || !followUp}>{saving ? 'Starting…' : 'Start follow-up plan'}</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => void close()}>Cancel</Button></div>
      </form>
    </Modal>
  </>
}

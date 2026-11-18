import { useCallback, useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { api } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import { Button } from '../ui/Button'

// Optional course reminders (W9.3): due dates, inactivity and support ending.
// Shown only to learners whose cohort sends them. Access-ending reminders are
// essential and arrive either way, which the copy says.
export function ReminderPreference({ v2 }: { v2: boolean }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setEnabled(null); setError(null)
    try {
      const response = await api.getNudgePreference()
      if (typeof response.data?.learner_nudges_enabled === 'boolean') setEnabled(response.data.learner_nudges_enabled)
      else setError(response.error || 'Could not load this preference')
    } catch { setError('Could not load this preference') }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = async () => {
    if (enabled === null || saving) return
    setSaving(true)
    try {
      const response = await api.updateNudgePreference(!enabled)
      if (typeof response.data?.learner_nudges_enabled === 'boolean') {
        setEnabled(response.data.learner_nudges_enabled)
        toast.success(response.data.learner_nudges_enabled ? 'Course reminders turned on' : 'Course reminders turned off')
      } else toast.error(response.error || 'Could not update course reminders')
    } catch { toast.error('Could not update course reminders') }
    finally { setSaving(false) }
  }

  return <div className="flex items-start justify-between gap-5 border-t border-line px-5 py-5 sm:px-6">
    <div className="flex min-w-0 gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><CalendarClock className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">Course reminders</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-ink-secondary">A heads-up before due dates, after a week away, and before your help period ends. Reminders that your course access is ending always arrive.</p>
      </div>
    </div>
    {enabled === null ? (
      error ? <Button variant="secondary" size="sm" onClick={() => void load()} className="shrink-0">Retry</Button>
        : <span role="status" className="min-h-11 shrink-0 px-2 py-3 text-xs font-semibold text-ink-muted">Loading…</span>
    ) : (
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Course reminders"
        aria-busy={saving}
        onClick={() => void toggle()}
        disabled={saving}
        className={`relative mt-0.5 ${v2 ? 'h-11 w-12' : 'h-7 w-12'} shrink-0 rounded-full transition-colors duration-200 ease-out before:absolute before:-inset-2 before:content-[''] disabled:opacity-50 ${v2 ? '' : enabled ? 'bg-ink' : 'bg-line ring-1 ring-inset ring-line-control'}`}
      >
        {v2 && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-2 h-7 rounded-full transition-colors duration-200 ${enabled ? 'bg-ink' : 'bg-line ring-1 ring-inset ring-line-control'}`} />}
        <span className={`absolute left-0 ${v2 ? 'top-2.5' : 'top-0.5'} h-6 w-6 rounded-full bg-surface-raised shadow-sm transition-transform duration-200 ease-out ${v2 ? 'motion-reduce:transition-none ' : ''}${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </button>
    )}
  </div>
}

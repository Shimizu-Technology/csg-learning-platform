import { useEffect, useState } from 'react'
import { CopyPlus, TriangleAlert } from 'lucide-react'
import { api } from '../../../lib/api'
import { Modal } from '../../../components/shared/Modal'
import { Button } from '../../../components/ui/Button'
import type { CurriculumCopyPreview, CurriculumCopyResponse } from '../../../types/api'
import { cohortList } from '../../../lib/lessonEditing'

type CohortChoice = { id: number; name: string }

interface Props {
  open: boolean
  onClose: () => void
  /** The shared curriculum, as the editor or Content loaded it. */
  curriculumId: number
  /** Cohorts this person can make a copy for (LessonEditAccess.copy_cohorts). */
  cohorts: CohortChoice[]
  /**
   * Called once the copy exists. The dialog stays open, and can't be
   * dismissed, until the returned promise settles, so the page can move to
   * the copy before anyone edits the shared version again.
   */
  onCopied: (copy: CurriculumCopyResponse['curriculum_copy']) => Promise<void> | void
}

function plural(count: number, word: string, many = `${word}s`) {
  return `${count.toLocaleString()} ${count === 1 ? word : many}`
}

/** What moves with the cohort, in the words staff use; rows with nothing to move are left out. */
export function copyCountLines(counts: Record<string, number>) {
  const n = (...keys: string[]) => keys.reduce((sum, key) => sum + (counts[key] || 0), 0)
  return [
    n('progresses') && plural(n('progresses'), 'step with progress', 'steps with progress'),
    n('submissions') && plural(n('submissions'), 'submission'),
    n('knowledge_check_attempts') && plural(n('knowledge_check_attempts'), 'checkpoint answer'),
    n('cohort_module_schedules', 'cohort_module_submission_windows', 'module_assignments', 'lesson_assignments') &&
      plural(n('cohort_module_schedules', 'cohort_module_submission_windows', 'module_assignments', 'lesson_assignments'), 'release date or access setting', 'release dates or access settings'),
    n('learning_plans') && plural(n('learning_plans'), 'personal plan'),
    n('help_requests') && plural(n('help_requests'), 'help request'),
    n('messages', 'notifications') && plural(n('messages', 'notifications'), 'message or notification link', 'message and notification links'),
  ].filter((line): line is string => Boolean(line))
}

/**
 * Make a copy for this cohort (README §12, decision 1): the cohort switches
 * to its own copy of the curriculum with its progress, submissions and
 * release dates; other cohorts keep the shared version. The dry run shows
 * what moves first. An answer for a cohort no longer chosen is dropped.
 */
export function CopyForCohortDialog({ open, onClose, curriculumId, cohorts, onCopied }: Props) {
  const [cohortId, setCohortId] = useState<number | null>(cohorts[0]?.id ?? null)
  const [preview, setPreview] = useState<{ cohortId: number; data: CurriculumCopyPreview } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCohortId((current) => (current && cohorts.some((cohort) => cohort.id === current) ? current : cohorts[0]?.id ?? null))
    setError(null)
  }, [open, cohorts])

  useEffect(() => {
    if (!open || !cohortId) return
    let active = true
    setLoadError(null)
    void api.getCurriculumCopyPreview(cohortId, curriculumId).then((response) => {
      if (!active) return
      if (response.data) setPreview({ cohortId, data: response.data.curriculum_copy_preview })
      else setLoadError(response.error || 'The copy couldn\'t be checked.')
    })
    return () => { active = false }
  }, [open, cohortId, curriculumId])

  const current = preview && preview.cohortId === cohortId ? preview.data : null
  const cohortName = cohorts.find((cohort) => cohort.id === cohortId)?.name || 'this cohort'
  const others = current ? cohortList(current.shared_with.map((cohort) => cohort.name)) : ''
  const lessons = current?.counts.lessons ?? 0
  const lines = current ? copyCountLines(current.counts) : []

  const submit = async () => {
    if (!cohortId || !current || busy || (!current.can_copy && !current.already_copied)) return
    const requested = cohortId
    setBusy(true)
    setError(null)
    const response = await api.copyCurriculumForCohort(requested, curriculumId)
    if (!response.data) {
      setBusy(false)
      setError(response.error || 'The copy wasn\'t made. Nothing changed; try again.')
      return
    }
    try {
      await onCopied(response.data.curriculum_copy)
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(current && (current.can_copy || current.already_copied))
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="md"
      title={`Make a copy for ${cohortName}?`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? 'Making the copy…' : current?.already_copied ? 'Open the copy' : 'Make a copy'}
        </Button>
      </>}
    >
      <div className="space-y-4 text-sm text-ink-secondary">
        {cohorts.length > 1 && (
          <label className="block font-semibold text-ink">Cohort
            <select className="app-control mt-1 w-full" value={cohortId ?? ''} disabled={busy} onChange={(event) => { setCohortId(Number(event.target.value)); setError(null) }}>
              {cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
            </select>
          </label>
        )}
        {loadError ? <p role="alert" className="text-danger-ink">{loadError}</p> : !current ? <p className="text-ink-muted">Checking what moves with {cohortName}…</p> : current.already_copied ? (
          <p>{cohortName} already has its own copy. Open it to keep editing.</p>
        ) : (
          <>
            <p>
              {cohortName} switches to its own copy of {current.source_curriculum?.name}{lessons ? ` (${plural(lessons, 'lesson')})` : ''}. Its progress, submissions and release dates stay attached.
              {others ? ` ${others} ${current.shared_with.length === 1 ? 'keeps' : 'keep'} the shared version.` : ''}
            </p>
            <p>Later changes to the shared version won't reach {cohortName}'s copy.</p>
            {lines.length > 0 && (
              <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
                <p className="font-semibold text-ink">Moves with {cohortName}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 tabular-nums" data-testid="copy-counts">
                  {lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
            {current.blockers.length > 0 && (
              <div role="alert" className="flex gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-warning-ink">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="space-y-1">{current.blockers.map((blocker) => <p key={blocker.code}>{blocker.message}</p>)}</div>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
      </div>
    </Modal>
  )
}

interface ActionProps {
  curriculumId: number
  cohorts: CohortChoice[]
  onCopied: Props['onCopied']
  variant?: 'primary' | 'secondary'
  className?: string
}

/** The "Make a copy for Cohort 3" button with its dialog. */
export function CopyForCohortAction({ curriculumId, cohorts, onCopied, variant = 'primary', className }: ActionProps) {
  const [open, setOpen] = useState(false)
  if (cohorts.length === 0) return null
  const label = cohorts.length === 1 ? `Make a copy for ${cohorts[0].name}` : 'Make a copy for one cohort'
  return (
    <>
      <Button variant={variant} size="sm" className={className} onClick={() => setOpen(true)}>
        <CopyPlus className="h-4 w-4" aria-hidden="true" />{label}
      </Button>
      <CopyForCohortDialog open={open} onClose={() => setOpen(false)} curriculumId={curriculumId} cohorts={cohorts} onCopied={async (copy) => { await onCopied(copy); setOpen(false) }} />
    </>
  )
}

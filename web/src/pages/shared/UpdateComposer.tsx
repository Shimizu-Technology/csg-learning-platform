import { useRef, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react'
import { Lock, Megaphone, Save, Send } from 'lucide-react'
import { LazyMarkdownEditor } from '../../components/shared/LazyMarkdownEditor'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../contexts/ConfirmContext'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import type { Announcement, CohortSummary } from '../../types/api'

export type UpdateAudience = 'cohort' | 'global' | 'staff'

export interface UpdateForm {
  title: string
  body: string
  audience: UpdateAudience
  /** null follows the page's cohort until the poster picks one explicitly. */
  cohort_id: string | null
  pinned: boolean
  send_push: boolean
}

export const EMPTY_UPDATE_FORM: UpdateForm = { title: '', body: '', audience: 'cohort', cohort_id: null, pinned: false, send_push: true }

export function formFromUpdate(update: Announcement): UpdateForm {
  return {
    title: update.title,
    body: update.body,
    audience: update.audience || 'cohort',
    cohort_id: update.cohort_id ? String(update.cohort_id) : null,
    pinned: Boolean(update.pinned),
    send_push: true,
  }
}

/** What a save did: a draft was saved, an update was posted, or a posted update was edited. */
export type UpdateSaveOutcome = 'draft' | 'posted' | 'edited'

const newClientRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `update-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)

/**
 * A save in progress. The page that shows the composer holds it, so leaving
 * Manage and coming back (which remounts the composer) still shows the save
 * as pending and can't send a second one.
 */
export interface UpdateRequest {
  busy: 'draft' | 'post' | null
  setBusy: (busy: 'draft' | 'post' | null) => void
  /** Blocks a second click before React re-renders the disabled buttons. */
  inFlight: MutableRefObject<boolean>
  /**
   * Sent with every create of this update. A retry, or a second request that
   * reaches the server, gets back the update the first one made instead of a
   * duplicate. A new id is drawn once the update is saved.
   */
  clientRequestId: MutableRefObject<string>
}

export function useUpdateRequest(): UpdateRequest {
  const [busy, setBusy] = useState<'draft' | 'post' | null>(null)
  const inFlight = useRef(false)
  const clientRequestId = useRef('')
  if (!clientRequestId.current) clientRequestId.current = newClientRequestId()
  return { busy, setBusy, inFlight, clientRequestId }
}

export interface UpdateComposerProps {
  form: UpdateForm
  setForm: Dispatch<SetStateAction<UpdateForm>>
  cohorts: CohortSummary[]
  /** The cohort the page is scoped to. Posting there needs no confirmation (U-0.3). */
  contextCohort: CohortSummary | null
  /** The cohort used while `form.cohort_id` is null (the page's cohort). */
  defaultCohortId: string | null
  /** A draft to finish or a posted update to edit; omitted for a new update. */
  editing?: Announcement
  onSaved: (update: Announcement, outcome: UpdateSaveOutcome) => void | Promise<void>
  onCancel?: () => void
  /** The save in progress, held by the page; the composer keeps its own when omitted. */
  request?: UpdateRequest
}

const countLabel = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`

/**
 * Writes an update (U-3.6). A new update or a draft can be saved as a draft,
 * which notifies nobody, or posted after the audience check. A posted update
 * keeps its audience; its title and body can change without notifying anyone
 * again. Scheduling waits for a job runner (AS-6), so there is no schedule control.
 */
export function UpdateComposer({ form, setForm, cohorts, contextCohort, defaultCohortId, editing, onSaved, onCancel, request: heldRequest }: UpdateComposerProps) {
  const confirmAction = useConfirm()
  const ownRequest = useUpdateRequest()
  const { busy, setBusy, inFlight, clientRequestId } = heldRequest ?? ownRequest
  const [error, setError] = useState('')
  // The fields are locked while a save is pending, so nothing typed then is
  // lost when the saved update replaces the form.
  const locked = busy !== null
  const posted = Boolean(editing && editing.status !== 'draft')
  const isDraft = editing?.status === 'draft'
  const audienceCohort = cohorts.find((cohort) => String(cohort.id) === (form.cohort_id ?? defaultCohortId)) || null
  const heading = posted ? 'Edit update' : isDraft ? 'Edit draft' : 'Post an update'

  const audienceProblem = () => (form.audience === 'cohort' && !audienceCohort ? 'Choose which cohort this update is for.' : '')

  const confirmAudience = async () => {
    const fromContext = form.audience === 'cohort' && audienceCohort?.id === contextCohort?.id
    if (fromContext) return true
    return confirmAction(form.audience === 'global' ? {
      title: 'Post to everyone?',
      description: 'This update goes to every student and staff member in the school, not just one cohort.',
      confirmLabel: 'Post to everyone',
    } : form.audience === 'staff' ? {
      title: 'Post to staff only?',
      description: 'Students will not see this update.',
      confirmLabel: 'Post to staff',
    } : {
      title: `Post to ${audienceCohort!.name}?`,
      description: `${contextCohort ? `You are viewing ${contextCohort.name}, but this` : 'This'} will go to ${audienceCohort!.name} (${countLabel(audienceCohort!.enrolled_count)}).`,
      confirmLabel: `Post to ${audienceCohort!.name}`,
    })
  }

  const fields = () => ({
    title: form.title.trim(),
    body: trimBlankLines(form.body),
    ...(posted ? {} : { audience: form.audience, cohort_id: form.audience === 'cohort' ? audienceCohort!.id : null }),
    pinned: form.pinned,
  })

  const run = async (kind: 'draft' | 'post', data: Parameters<typeof api.updateAnnouncement>[1], outcome: UpdateSaveOutcome) => {
    inFlight.current = true
    setBusy(kind)
    try {
      // `data` is the submitted snapshot, not whatever the form contains
      // when a slow response arrives. Keep the fields locked through PATCH.
      let res: Awaited<ReturnType<typeof api.updateAnnouncement>>
      try {
        res = editing
          ? await api.updateAnnouncement(editing.id!, data)
          : await api.createAnnouncement({ ...data, title: data.title!, body: data.body!, audience: data.audience!, client_request_id: clientRequestId.current })
        if (!editing && res.data && !res.error) {
          const saved = res.data.announcement
          const changed = Object.entries(data).some(([key, value]) => key !== 'send_push' && saved[key as keyof Announcement] !== value)
          // A lost response may replay an older draft (or an already posted
          // update). Reconcile before clearing; PATCH posts a draft once and
          // only edits an update that is already posted.
          if (changed) res = await api.updateAnnouncement(saved.id!, data)
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not save this update. Try again.')
        return
      }
      if (res.error || !res.data) {
        // Retain the id even if reconciliation fails: retry the same record.
        setError(res.error || 'Could not save this update. Try again.')
        return
      }
      setError('')
      await onSaved(res.data.announcement, outcome)
      if (!editing) clientRequestId.current = newClientRequestId()
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    if (posted) {
      if (!form.title.trim()) return setError('Give the update a title.')
      if (!form.body.trim()) return setError('Write the update before saving it.')
      return run('post', fields(), 'edited')
    }
    const problem = audienceProblem() || (!form.body.trim() ? 'Write the update before posting it.' : !form.title.trim() ? 'Give the update a title.' : '')
    if (problem) return setError(problem)
    setError('')
    if (!await confirmAudience()) return
    const data = { ...fields(), status: 'published', send_push: form.send_push }
    return run('post', data, 'posted')
  }

  const saveDraft = async () => {
    if (inFlight.current) return
    const problem = audienceProblem() || (!form.title.trim() ? 'Give the draft a title so you can find it in Drafts.' : '')
    if (problem) return setError(problem)
    const data = { ...fields(), status: 'draft' }
    return run('draft', data, 'draft')
  }

  const audienceLine = form.audience === 'global' ? <>Everyone · all students and staff</>
    : form.audience === 'staff' ? <>Staff only</>
    : audienceCohort ? <>{audienceCohort.name} · {countLabel(audienceCohort.enrolled_count)}</>
    : null
  const postedAudience = editing?.audience === 'global' ? 'Everyone' : editing?.audience === 'staff' ? 'Staff only' : editing?.cohort_name || 'One cohort'

  return (
    <form onSubmit={submit} className="app-surface space-y-4 p-5 sm:p-6" aria-label={heading}>
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <h2 className="text-lg font-bold text-ink">{heading}</h2>
      </div>
      <div className={posted ? 'grid gap-3' : 'grid gap-3 md:grid-cols-[1fr_180px_220px]'}>
        <input
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Title"
          aria-label="Title"
          required
          disabled={locked}
          className="app-control"
        />
        {!posted && <>
          <select
            value={form.audience}
            onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value as UpdateAudience }))}
            aria-label="Audience"
            disabled={locked}
            className="app-control"
          >
            <option value="cohort">Cohort</option>
            <option value="global">Everyone</option>
            <option value="staff">Staff only</option>
          </select>
          <select
            value={audienceCohort ? String(audienceCohort.id) : ''}
            onChange={(event) => setForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
            disabled={locked || form.audience !== 'cohort'}
            required={form.audience === 'cohort'}
            aria-label="Cohort for this update"
            className="app-control"
          >
            <option value="" disabled>Choose a cohort…</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
            ))}
          </select>
        </>}
      </div>
      {posted && (
        <div className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <p data-testid="announcement-audience">
            Posted to <strong className="text-ink">{postedAudience}</strong>. Who sees an update can’t change after it’s posted; to reach other people, post a new update.
          </p>
        </div>
      )}
      <LazyMarkdownEditor
        label="Update"
        value={form.body}
        onChange={(body) => setForm((prev) => ({ ...prev, body }))}
        placeholder="What should students know?"
        minHeight={120}
        maxHeight={420}
        disabled={locked}
      />
      {error && (
        <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={form.pinned}
              disabled={locked}
              onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
              className="h-4 w-4 rounded border-line-strong accent-action-primary"
            />
            Pin this
          </label>
          {!posted && (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={form.send_push}
                disabled={locked}
                onChange={(event) => setForm((prev) => ({ ...prev, send_push: event.target.checked }))}
                className="h-4 w-4 rounded border-line-strong accent-action-primary"
              />
              Send push when posted
            </label>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {posted ? (
            <p className="text-sm text-ink-secondary">Saving doesn’t notify anyone again. Readers see “Edited”.</p>
          ) : (
            <p role="status" data-testid="announcement-audience" className={`text-sm ${audienceLine ? 'text-ink-secondary' : 'font-semibold text-danger-ink'}`}>
              {audienceLine ? <>Posting to: <strong className="text-ink">{audienceLine}</strong></> : 'Choose a cohort to post to'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {onCancel && <Button type="button" variant="quiet" onClick={onCancel} disabled={busy !== null}>Cancel</Button>}
            {!posted && (
              <Button type="button" variant="secondary" onClick={saveDraft} disabled={busy !== null}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {busy === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
            )}
            <Button type="submit" disabled={busy !== null}>
              {posted ? <Save className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {posted ? (busy ? 'Saving…' : 'Save changes') : busy === 'post' ? 'Posting…' : 'Post update'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

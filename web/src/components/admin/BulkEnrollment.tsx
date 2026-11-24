import { useState } from 'react'
import { Download } from 'lucide-react'
import { api, type BulkEnrollmentResult, type BulkEnrollmentState } from '../../lib/api'
import { parseEnrollmentRows } from '../../lib/bulkEnrollment'
import { humanize } from '../../lib/glossary'
import { RecordLink } from '../shared/RecordLink'
import { Button } from '../ui/Button'

const CSV_TEMPLATE = 'email,first_name,last_name\nstudent@example.com,Jane,Doe\n'

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'cohort-students-template.csv'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function BulkEnrollment({
  cohortId,
  seatLimit,
  seatsTaken,
  onSaved,
}: {
  cohortId: number
  seatLimit?: number | null
  seatsTaken?: number | null
  onSaved: () => void
}) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'enrolling' | 'inviting'>('enrolling')
  const [resume, setResume] = useState<BulkEnrollmentState>()
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<BulkEnrollmentResult[]>([])
  const [resendingUserId, setResendingUserId] = useState<number | null>(null)
  const rows = parseEnrollmentRows(input)
  const valid = rows.filter((r) => !r.error)
  const crossesSeatCap =
    seatLimit != null && seatsTaken != null && seatsTaken + valid.length > seatLimit

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const response = await api.bulkEnroll(
        cohortId,
        valid.map(({ email, first_name, last_name }) => ({ email, first_name, last_name })),
        invite,
        (count, nextPhase) => {
          setProgress(count)
          setPhase(nextPhase)
        },
        resume,
      )
      setResume(response.resume)
      if (!response.data || response.error) {
        setError(
          (response.error || 'Could not add students.') +
            ' Resume to continue from the failed chunk. Completed work is kept.',
        )
      } else {
        setResults(response.data.results)
        onSaved()
      }
    } catch {
      setError('Could not add students. You can safely retry this upload.')
    } finally {
      setBusy(false)
    }
  }

  async function resendRowInvite(userId: number) {
    setResendingUserId(userId)
    try {
      const res = await api.resendInvite(userId)
      if (res.error || !res.data) {
        setResults((current) =>
          current.map((item) =>
            item.user_id === userId
              ? { ...item, invitation_status: 'failed', error: res.error || 'Invite failed. Try again.' }
              : item,
          ),
        )
      } else {
        setResults((current) =>
          current.map((item) =>
            item.user_id === userId
              ? { ...item, invitation_status: res.data!.invitation.status, error: res.data!.invitation.error ?? undefined }
              : item,
          ),
        )
        onSaved()
      }
    } finally {
      setResendingUserId(null)
    }
  }

  return (
    <details className="app-surface p-5">
      <summary className="min-h-11 cursor-pointer font-semibold">Add students in bulk</summary>
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-secondary">
            Paste one email per line, or upload a CSV with email, first_name and last_name columns. Up to 200 rows.
            Existing enrollments are kept.
          </p>
          <Button variant="quiet" size="sm" onClick={downloadCsvTemplate}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download CSV template
          </Button>
        </div>

        <label className="block text-sm font-semibold">
          Emails or CSV
          <textarea
            className="app-control mt-2 min-h-32 w-full"
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value)
              setPreview(false)
              setResults([])
              setResume(undefined)
            }}
          />
        </label>

        <label className="block text-sm font-semibold">
          Upload CSV
          <input
            className="app-control mt-2 w-full"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (file.size > 1_000_000) {
                setError('CSV must be smaller than 1 MB.')
                return
              }
              setInput(await file.text())
              setPreview(false)
              setResults([])
              setResume(undefined)
            }}
          />
        </label>

        <Button variant="secondary" disabled={busy || !rows.length} onClick={() => setPreview(true)}>
          Preview students
        </Button>

        {preview && (
          <>
            <p className="text-sm">
              {valid.length} valid · {rows.length - valid.length} invalid or duplicate
            </p>
            <p className="text-xs text-ink-muted">
              “Ready” checks email format only. Staff-account conflicts and previously withdrawn enrollments are checked
              when you submit.
            </p>
            {crossesSeatCap && (
              <p role="status" className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-ink">
                Adding {valid.length} students will exceed the paid checkout seat limit of {seatLimit} ({seatsTaken} currently occupied). Staff enrollment still proceeds and will mark paid checkout full.
              </p>
            )}
            {rows.length > 200 && <p role="alert">Reduce the upload to 200 rows.</p>}
            <ul className="max-h-64 space-y-2 overflow-auto">
              {rows.map((r, i) => (
                <li key={i} className="break-all text-sm">
                  {r.email || '(empty email)'} — {r.error || 'Ready'}
                </li>
              ))}
            </ul>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy || !!resume}
                checked={invite}
                onChange={(e) => setInvite(e.target.checked)}
              />
              Send invitations to students awaiting an invite
            </label>
            <Button
              disabled={busy || !valid.length || rows.length > 200 || results.length > 0}
              onClick={() => void submit()}
            >
              {busy
                ? `${phase === 'inviting' ? 'Sending invitations' : 'Adding students'} ${progress} of ${valid.length}…`
                : resume
                  ? 'Resume upload'
                  : `Add ${valid.length} students`}
            </Button>
          </>
        )}

        {error && (
          <p role="alert" className="text-danger-ink">
            {error}
          </p>
        )}

        {results.length > 0 && (
          <div role="status" className="space-y-2">
            <p className="font-semibold">Enrollment results</p>
            <ul className="mt-2 space-y-2">
              {results.map((r) => (
                <li
                  key={r.row}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-all">
                    {r.email} —{' '}
                    {r.status === 'previously_dropped'
                      ? 'Previously withdrawn; not re-added'
                      : humanize(r.status)}
                    {r.error && `: ${r.error}`}
                    {r.invitation_status && ` · Invitation: ${humanize(r.invitation_status)}`}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {r.user_id && r.invitation_status === 'failed' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={resendingUserId !== null}
                        onClick={() => void resendRowInvite(r.user_id!)}
                      >
                        {resendingUserId === r.user_id ? 'Sending…' : 'Resend invite'}
                      </Button>
                    )}
                    {r.user_id && (
                      <RecordLink
                        record={{ type: 'student', id: r.user_id, cohortId, tab: 'access' }}
                        returnLabel="Bulk enrollment"
                        variant="app"
                        touchTarget
                        className="text-xs"
                      >
                        Open enrollment
                      </RecordLink>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

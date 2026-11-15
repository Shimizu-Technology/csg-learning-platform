import { humanize } from '../../lib/glossary'
import { useState } from 'react'
import { api } from '../../lib/api'
import { parseEnrollmentRows } from '../../lib/bulkEnrollment'
import { Button } from '../ui/Button'

export function BulkEnrollment({ cohortId, onSaved }: { cohortId: number; onSaved: () => void }) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Array<{ row: number; email: string; status: string; error?: string; invitation_status?: string | null }>>([])
  const rows = parseEnrollmentRows(input)
  const valid = rows.filter(r => !r.error)
  async function submit() {
    setBusy(true); setError('')
    try {
      const response = await api.bulkEnroll(cohortId, valid.map(({ email, first_name, last_name }) => ({ email, first_name, last_name })), invite)
      if (!response.data || response.error) setError(response.error || 'Could not add students.')
      else { setResults(response.data.results); onSaved() }
    } catch { setError('Could not add students. You can safely retry this upload.') }
    finally { setBusy(false) }
  }
  return <details className="app-surface p-5"><summary className="min-h-11 cursor-pointer font-semibold">Add students in bulk</summary><div className="mt-4 space-y-4">
    <p className="text-sm text-ink-secondary">Paste one email per line, or upload a CSV with email, first_name and last_name columns. Up to 200 rows. Existing enrollments are kept.</p>
    <label className="block text-sm font-semibold">Emails or CSV<textarea className="app-control mt-2 min-h-32 w-full" value={input} disabled={busy} onChange={e => { setInput(e.target.value); setPreview(false); setResults([]) }} /></label>
    <label className="block text-sm font-semibold">Upload CSV<input className="app-control mt-2 w-full" type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setError('CSV must be smaller than 1 MB.'); return } setInput(await file.text()); setPreview(false); setResults([]) }} /></label>
    <Button variant="secondary" disabled={busy || !rows.length} onClick={() => setPreview(true)}>Preview students</Button>
    {preview && <><p className="text-sm">{valid.length} valid · {rows.length - valid.length} invalid or duplicate</p>{rows.length > 200 && <p role="alert">Reduce the upload to 200 rows.</p>}<ul className="max-h-64 space-y-2 overflow-auto">{rows.map((r, i) => <li key={i} className="break-all text-sm">{r.email || '(empty email)'} — {r.error || 'Ready'}</li>)}</ul><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={invite} onChange={e => setInvite(e.target.checked)} />Send invitations to newly enrolled students</label><Button disabled={busy || !valid.length || rows.length > 200 || results.length > 0} onClick={() => void submit()}>{busy ? 'Adding…' : `Add ${valid.length} students`}</Button></>}
    {error && <p role="alert" className="text-danger-ink">{error}</p>}
    {results.length > 0 && <div role="status"><p className="font-semibold">Enrollment results</p><ul className="mt-2 space-y-2">{results.map(r => <li key={r.row} className="break-all text-sm">{r.email} — {humanize(r.status)}{r.error && `: ${r.error}`}{r.invitation_status && ` · Invitation: ${r.invitation_status}`}</li>)}</ul></div>}
  </div></details>
}

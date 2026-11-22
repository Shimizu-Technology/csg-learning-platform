import { useState, type FormEvent } from 'react'
import { Award, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { certificatePath, type StaffCourseCertificate } from '../../lib/certificates'
import { formatShortDate } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { Button, LinkButton } from '../ui/Button'
import { Modal } from '../shared/Modal'

export function StudentCertificatePanel({ summary, enrollmentId, onSaved }: {
  summary: StaffCourseCertificate
  enrollmentId: number
  onSaved: () => Promise<unknown>
}) {
  const [action, setAction] = useState<'revoke' | 'reissue' | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { certificate } = summary
  const active = certificate && !certificate.revoked
  const issueLabel = certificate ? 'Reissue certificate' : 'Issue certificate'
  const actionLabel = action === 'revoke' ? 'Revoke certificate' : issueLabel

  function open(next: 'revoke' | 'reissue') {
    setReason('')
    setError(null)
    setAction(next)
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || pending) return

    setPending(true)
    setError(null)
    try {
      const result = await api.manageCertificate(enrollmentId, action, reason.trim())
      if (!result.data) throw new Error(result.error || 'Could not update the certificate.')
      setAction(null)
      await onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the certificate.')
    } finally {
      setPending(false)
    }
  }

  return <section className="app-surface space-y-4 p-5" aria-label="Course certificate">
    <div className="flex items-center gap-2">
      <Award className="size-5 text-ink-secondary" aria-hidden="true" />
      <h2 className="font-bold text-ink">Course certificate</h2>
      <Badge tone={active ? 'success' : certificate ? 'danger' : 'neutral'}>{active ? 'Active' : certificate ? 'Revoked' : 'Not issued'}</Badge>
    </div>
    {certificate ? <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div><dt className="text-ink-secondary">Code</dt><dd className="mt-1 font-mono font-semibold">{certificate.code}</dd></div>
      <div><dt className="text-ink-secondary">Issued</dt><dd className="mt-1 font-semibold">{formatShortDate(certificate.issued_at)}</dd></div>
      {certificate.revoked_at && <div><dt className="text-ink-secondary">Revoked</dt><dd className="mt-1 font-semibold">{formatShortDate(certificate.revoked_at)}</dd></div>}
    </dl> : <p className="text-sm text-ink-secondary">{summary.course_completed ? 'Course completion is recorded.' : 'A certificate is issued automatically when the required work passes review.'}</p>}
    <div className="flex flex-wrap gap-2">
      {certificate && <LinkButton to={certificatePath(certificate.code)} variant="secondary">Verify link <ExternalLink className="size-4" aria-hidden="true" /></LinkButton>}
      {summary.can_issue && <Button variant="secondary" onClick={() => open('reissue')} disabled={pending}>{issueLabel}</Button>}
      {active && <Button variant="danger" onClick={() => open('revoke')} disabled={pending}>Revoke certificate</Button>}
    </div>
    <Modal open={action !== null} onClose={() => { if (!pending) setAction(null) }} title={actionLabel} size="md">
      <form onSubmit={(event) => void confirm(event)} className="space-y-4">
        <p className="text-sm text-ink-secondary">
          {action === 'revoke' ? 'The current verification link will show this certificate as revoked.'
            : active ? 'The current link will show as revoked. The learner will receive a certificate with a new verification link.'
            : summary.course_completed ? 'The learner will receive a certificate with a new verification link.'
              : 'This issues a certificate as a staff decision. Explain why you are issuing it before the course is marked complete.'}
        </p>
        <label className="block text-sm font-semibold text-ink">
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={1000} rows={3} className="app-control mt-1 block w-full" />
        </label>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setAction(null)} disabled={pending}>Cancel</Button>
          <Button type="submit" variant={action === 'revoke' ? 'danger' : 'primary'} disabled={pending || !reason.trim()}>{pending ? 'Saving…' : actionLabel}</Button>
        </div>
      </form>
    </Modal>
  </section>
}

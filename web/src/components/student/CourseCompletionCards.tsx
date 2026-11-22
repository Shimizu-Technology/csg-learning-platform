import { useState, type FormEvent } from 'react'
import { ArrowRight, Award, Pencil, Printer } from 'lucide-react'
import { api } from '../../lib/api'
import { CERTIFICATE_TITLE, certificatePath, type CertificateVerification, type CourseCompletion } from '../../lib/certificates'
import { CertificateLinkActions } from '../shared/CertificateLinkActions'
import { Modal } from '../shared/Modal'
import { AnchorButton, Button, LinkButton } from '../ui/Button'

export function CourseCompletionCards({ completion, editable = true }: { completion: CourseCompletion; editable?: boolean }) {
  const { certificate, next_step: nextStep } = completion
  if (!certificate && !nextStep) return null

  return <div className="space-y-4">
    {certificate && <LearnerCertificate key={certificate.code} certificate={certificate} enrollmentId={completion.enrollment_id} editable={editable} />}
    {nextStep && <section className="app-surface space-y-3 p-5">
      <h2 className="text-base font-bold text-ink">Next step</h2>
      <div>
        <p className="font-semibold text-ink [overflow-wrap:anywhere]">{nextStep.title}</p>
        {nextStep.description && <p className="mt-1 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{nextStep.description}</p>}
      </div>
      {nextStep.offering_slug
        ? <LinkButton to={`/courses/${encodeURIComponent(nextStep.offering_slug)}`} variant="secondary">Explore this course <ArrowRight className="size-4" aria-hidden="true" /></LinkButton>
        : nextStep.url && <AnchorButton href={nextStep.url}>Open next step <ArrowRight className="size-4" aria-hidden="true" /></AnchorButton>}
    </section>}
  </div>
}

function LearnerCertificate({ certificate, enrollmentId, editable }: { certificate: CertificateVerification; enrollmentId: number; editable: boolean }) {
  const [savedName, setSavedName] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const printedName = savedName ?? certificate.holder_name

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await api.updateCertificateName(enrollmentId, name.trim())
      if (!result.data) throw new Error(result.error || 'Could not save your printed name.')
      setSavedName(result.data.certificate.holder_name)
      setEditing(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your printed name.')
    } finally {
      setPending(false)
    }
  }

  return <section className="app-surface space-y-3 p-5">
    <div className="flex items-start gap-3">
      <Award className="size-6 shrink-0 text-success-ink" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="font-bold text-ink">{CERTIFICATE_TITLE}</h2>
        <p className="mt-1 text-sm text-ink-secondary [overflow-wrap:anywhere]">{printedName} · {certificate.course_title}</p>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <LinkButton to={certificatePath(certificate.code)}>
        <Printer className="size-4" aria-hidden="true" /> View &amp; print certificate
      </LinkButton>
      <CertificateLinkActions code={certificate.code} />
      {editable && <Button variant="quiet" onClick={() => { setName(printedName); setError(null); setEditing(true) }}>
        <Pencil className="size-4" aria-hidden="true" /> Edit printed name
      </Button>}
    </div>
    <Modal open={editing} onClose={() => { if (!pending) setEditing(false) }} title="Edit printed name" size="md">
      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <label className="block text-sm font-semibold text-ink">
          Printed name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} className="app-control mt-1 block w-full" />
        </label>
        <p className="text-sm text-ink-secondary">Anyone with the verification link can see this name. It also appears when you print the certificate.</p>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending || !name.trim()}>{pending ? 'Saving…' : 'Save printed name'}</Button>
        </div>
      </form>
    </Modal>
  </section>
}

export function CourseCompletionStatus({ completion, editable }: { completion?: CourseCompletion; editable?: boolean }) {
  if (!completion || !(completion.all_work_handed_in || completion.course_completed || completion.certificate)) return null

  return <div className="space-y-4">
    {(completion.course_completed || completion.all_work_handed_in) && <div className="app-surface p-5">
      <h2 className="font-bold text-ink">{completion.course_completed ? 'Course completed' : 'All work handed in'}</h2>
      {!completion.course_completed && <p className="mt-1 text-sm text-ink-secondary">Your instructor will confirm completion after reviewing your work.</p>}
    </div>}
    <CourseCompletionCards completion={completion} editable={editable} />
  </div>
}

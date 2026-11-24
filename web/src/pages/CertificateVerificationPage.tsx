import { useEffect, useState } from 'react'
import { Award, CheckCircle2, CircleX, Mail, Printer } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { CertificateLinkActions } from '../components/shared/CertificateLinkActions'
import { AnchorButton, Button, LinkButton } from '../components/ui/Button'
import { api } from '../lib/api'
import { brand, PRODUCT_NAME } from '../lib/brand'
import { CERTIFICATE_TITLE, type CertificateVerification } from '../lib/certificates'
import { formatShortDate } from '../lib/format'

type Verification = { certificate: CertificateVerification } | { error: string; notFound?: boolean; retry: boolean } | null

export function CertificateVerificationPage() {
  const { code = '' } = useParams()
  return <VerificationPage key={code} code={code} />
}

function VerificationPage({ code }: { code: string }) {
  const [result, setResult] = useState<Verification>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    void api.verifyCertificate(code).then((response) => {
      if (!current) return
      if (response.data) setResult(response.data)
      else if (response.status === 404) setResult({ error: 'Certificate not found', notFound: true, retry: false })
      else if (response.status === 429) setResult({ error: 'Too many attempts. Wait a minute and try again.', retry: true })
      else setResult({ error: 'Certificate verification is unavailable. Try again in a moment.', retry: true })
    }).catch(() => {
      if (current) setResult({ error: 'Certificate verification is unavailable. Try again in a moment.', retry: true })
    })
    return () => { current = false }
  }, [code, attempt])

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink print:min-h-0 print:bg-surface-raised">
      <div className="print:hidden">
        <PublicHeader actions={<LinkButton to="/sign-in" variant="quiet" shape="brand" className="px-3 text-ink">Sign in</LinkButton>} />
      </div>
      <main className="certificate-page flex-1 px-4 py-8 sm:px-8 sm:py-12 print:p-0">
        <meta name="robots" content="noindex, nofollow" />
        <div className="mx-auto max-w-3xl print:max-w-none">
          {!result && <p role="status" className="text-center text-ink-secondary">Verifying certificate…</p>}
          {result && 'error' in result && (
            <div className="rounded-2xl border border-brand-line bg-surface-raised p-6 text-center shadow-raised sm:p-8">
              <h1 className="font-display text-3xl font-medium text-ink">{result.error}</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-secondary">
                {result.notFound
                  ? 'Check that the 12-character verification code in the link matches the code printed on the certificate.'
                  : 'We could not check this certificate right now. Try again in a moment or contact support.'}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {result.retry && (
                  <Button shape="brand" onClick={() => { setResult(null); setAttempt((value) => value + 1) }}>
                    Try again
                  </Button>
                )}
                <LinkButton to="/" shape="brand" variant={result.retry ? 'secondary' : 'primary'}>
                  Go to home
                </LinkButton>
                <LinkButton to="/sign-in" shape="brand" variant="secondary">
                  Sign in
                </LinkButton>
                <AnchorButton
                  href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent(`${PRODUCT_NAME} certificate verification help`)}`}
                  shape="brand"
                  variant="quiet"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Contact support
                </AnchorButton>
              </div>
            </div>
          )}
          {result && 'certificate' in result && <VerificationCard certificate={result.certificate} />}
        </div>
      </main>
      <div className="print:hidden">
        <PublicFooter />
      </div>
    </div>
  )
}

function VerificationCard({ certificate }: { certificate: CertificateVerification }) {
  const issuedOn = formatShortDate(certificate.issued_at)
  return <>
    <article className="certificate-sheet relative break-inside-avoid border border-line-strong bg-surface-raised p-2 shadow-raised sm:p-3 print:p-3 print:shadow-none">
      <div className="grid justify-items-center gap-5 border border-line px-4 py-8 text-center sm:gap-7 sm:px-10 sm:py-12 print:px-12 print:py-8">
        <p className="text-sm font-semibold tracking-wider text-ink-secondary [overflow-wrap:anywhere]">{certificate.issuer_name}</p>
        <span className="grid size-14 place-items-center rounded-full border border-line-strong bg-surface-sunken text-ink-secondary">
          <Award className="size-8" aria-hidden="true" />
        </span>
        <h1 className="font-display text-4xl leading-none sm:text-5xl print:text-5xl">{CERTIFICATE_TITLE}</h1>
        <p className="min-w-0 max-w-full [overflow-wrap:anywhere]">
          <span className="block font-display text-[clamp(2rem,5vw,3rem)] font-semibold leading-tight">{certificate.holder_name}</span>
          {certificate.wording_version === 1 && <span className="mx-auto mt-3 block max-w-prose text-sm leading-7 text-ink-secondary sm:text-base">
            completed <strong className="font-semibold text-ink">{certificate.course_title}</strong> at {certificate.issuer_name}, including a final project reviewed by {certificate.issuer_name}.
          </span>}
        </p>
        <dl className="flex flex-wrap justify-center gap-x-10 gap-y-3 border-t border-line pt-4 text-sm">
          <div><dt className="text-ink-secondary">Issued</dt><dd className="mt-0.5 font-semibold"><time dateTime={certificate.issued_at}>{issuedOn}</time></dd></div>
          <div><dt className="text-ink-secondary">Verification code</dt><dd className="mt-0.5 font-mono font-semibold tracking-wider">{certificate.code}</dd></div>
        </dl>
        {certificate.revoked ? <p className="inline-flex items-center gap-2 rounded-md border border-danger-line bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger-ink">
          <CircleX className="size-4" aria-hidden="true" />
          <span>Revoked</span>
          {certificate.revoked_at && <time dateTime={certificate.revoked_at}>{formatShortDate(certificate.revoked_at)}</time>}
        </p> : <p className="inline-flex items-center gap-2 rounded-md border border-success-line bg-success-soft px-3 py-1.5 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="size-4" aria-hidden="true" /> Verified
        </p>}
      </div>
    </article>
    <div aria-label="Certificate actions" className="mt-5 flex flex-wrap justify-center gap-2 print:hidden">
      {!certificate.revoked && <Button shape="brand" onClick={() => window.print()}><Printer className="size-4" aria-hidden="true" /> Print / Save PDF</Button>}
      <CertificateLinkActions code={certificate.code} share />
    </div>
  </>
}

import { brand } from '../../lib/brand'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { validOfferingSlug } from '../../lib/courseIntent'
import { Button, LinkButton } from '../ui/Button'

type Status = NonNullable<Awaited<ReturnType<typeof api.getCourseCheckoutStatus>>['data']>

export function CourseCheckoutStatus({ purchaseId, canceled = false, slug }: { purchaseId: string; canceled?: boolean; slug?: string }) {
  const { isSignedIn, syncSession } = useAuthContext()
  const [result, setResult] = useState<Status | null>(null)
  const [stopped, setStopped] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState('')
  useEffect(() => {
    if (!isSignedIn || !purchaseId) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + 60_000
    setStopped(false)
    setResult(null)
    const poll = async () => {
      try {
        const response = await api.getCourseCheckoutStatus(purchaseId)
        if (!active) return
        if (response.data && !response.error) {
          setResult(response.data)
          if (canceled || response.data.status !== 'pending') {
            clearTimeout(timeout)
            if (response.data.status === 'fulfilled') void syncSession()
            return
          }
        }
      } catch { /* Uncertain payments keep the safe confirmation state. */ }
      if (!active) return
      if (canceled) { clearTimeout(timeout); setStopped(true); return }
      if (Date.now() >= deadline) setStopped(true)
      else timer = setTimeout(() => void poll(), 2000)
    }
    // Also bound a stalled request. A late result may still resolve the purchase.
    const timeout = setTimeout(() => { if (active) setStopped(true) }, 60_000)
    void poll()
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout) }
  }, [isSignedIn, purchaseId, canceled, attempt, syncSession])

  async function resumeCheckout() {
    if (!result || resuming) return
    setResuming(true); setResumeError('')
    try {
      const response = await api.startCourseCheckout(result.cohort.id)
      if (response.data?.url) window.location.assign(response.data.url)
      else setResumeError(response.error || 'We couldn’t reopen checkout yet. Contact support before trying another payment.')
    } catch { setResumeError('We couldn’t reopen checkout yet. Contact support before trying another payment.') }
    finally { setResuming(false) }
  }

  const canContinue = result?.can_continue === true
  const setupFailed = result?.status === 'setup_failed'
  const starting = result?.status === 'starting'
  const fulfilled = result?.status === 'fulfilled'
  const problem = result?.status === 'failed' || result?.status === 'refunded'
  const validatedSlug = validOfferingSlug(slug)
  const signInParams = new URLSearchParams({ checkout: 'return', purchase_id: purchaseId })
  if (validatedSlug) signInParams.set('offering_slug', validatedSlug)
  const retrySlug = validOfferingSlug(result?.cohort.slug)
  const supportSubject = purchaseId ? `Enrollment help (reference #${purchaseId})` : 'Enrollment help'
  const supportHref = `mailto:${brand.supportEmail}?subject=${encodeURIComponent(supportSubject)}`

  const heading = !isSignedIn
    ? 'Sign in to confirm your enrollment'
    : canContinue && canceled
      ? 'Checkout wasn’t finished'
      : setupFailed
        ? 'We couldn’t start checkout'
        : starting
          ? 'Checking your checkout'
          : fulfilled
            ? 'You’re in'
            : problem
              ? result.status === 'refunded'
                ? 'Your purchase was refunded'
                : 'We couldn’t confirm your course access'
              : stopped || !purchaseId
                ? 'Still confirming — this can take a minute'
                : 'Confirming your enrollment…'

  const description = !isSignedIn
    ? 'Sign in with the account you used at checkout so we can confirm your seat. Please check here before making another payment.'
    : canContinue
      ? 'You haven’t been charged yet. Continue to checkout whenever you’re ready to finish enrolling.'
      : setupFailed
        ? 'You weren’t charged. Return to your course to try again.'
        : starting
          ? result.can_resume
            ? 'Your checkout didn’t finish opening. Resume it below or contact support before making another payment.'
            : `Contact ${brand.schoolName} support so we can check your order before you make another payment.`
          : problem
            ? result.status === 'refunded'
              ? `Contact ${brand.schoolName} support if you have questions about your refund or course access.`
              : `Contact ${brand.schoolName} support so we can check your order and course access.`
            : stopped || !purchaseId
              ? 'Your payment may still be finishing. Try again in a moment or contact support before making another payment.'
              : 'Please wait for confirmation before making another payment.'

  return <section className="mt-8 rounded-2xl border border-line bg-surface-raised p-6" aria-live="polite">
    <h2 className="text-xl font-bold">{heading}</h2>
    {fulfilled ? <LinkButton className="mt-4" to={`/dashboard?cohort_id=${result.cohort.id}`}>Open {result.cohort.name || 'Self-paced course'}</LinkButton>
      : <>
        <p className="mt-2 text-sm text-ink-secondary">{description}</p>
        {purchaseId && <p className="mt-2 text-xs text-ink-muted">Reference #{purchaseId}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!isSignedIn && <LinkButton to={`/sign-in?${signInParams}`}>Sign in to check enrollment</LinkButton>}
          {setupFailed && <LinkButton to={retrySlug ? `/courses/${retrySlug}` : `/courses?offering_id=${result.cohort.id}`}>Try checkout again</LinkButton>}
          {canContinue && <Button disabled={resuming} onClick={() => void resumeCheckout()}>{resuming ? 'Opening checkout…' : 'Continue checkout'}</Button>}
          {starting && result.can_resume && <Button disabled={resuming} onClick={() => void resumeCheckout()}>{resuming ? 'Resuming…' : 'Resume checkout'}</Button>}
          {(stopped || problem) && !canContinue && isSignedIn && purchaseId && <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
          <a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={supportHref}>Contact support</a>
        </div>
        {resumeError && <p role="alert" className="mt-3 text-sm text-danger-ink">{resumeError}</p>}
      </>}
  </section>
}

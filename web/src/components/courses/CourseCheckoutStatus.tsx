import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { Button, LinkButton } from '../ui/Button'

type Status = NonNullable<Awaited<ReturnType<typeof api.getCourseCheckoutStatus>>['data']>

export function CourseCheckoutStatus({ purchaseId }: { purchaseId: string }) {
  const { isSignedIn, syncSession } = useAuthContext()
  const [result, setResult] = useState<Status | null>(null)
  const [stopped, setStopped] = useState(false)
  const [attempt, setAttempt] = useState(0)
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
          if (response.data.status !== 'pending') {
            if (response.data.status === 'fulfilled') void syncSession()
            return
          }
        }
      } catch { /* Uncertain payments keep the safe confirmation state. */ }
      if (!active) return
      if (Date.now() >= deadline) setStopped(true)
      else timer = setTimeout(() => void poll(), 2000)
    }
    // Also bound a stalled request. A late result may still resolve the purchase.
    const timeout = setTimeout(() => { if (active) setStopped(true) }, 60_000)
    void poll()
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout) }
  }, [isSignedIn, purchaseId, attempt, syncSession])

  const fulfilled = result?.status === 'fulfilled'
  const problem = result?.status === 'failed' || result?.status === 'refunded'
  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6" aria-live="polite">
    <h2 className="text-xl font-bold">{fulfilled ? "You’re in" : problem ? result.status === 'refunded' ? 'Your purchase was refunded' : 'We could not confirm course access' : stopped || !purchaseId ? 'Still confirming — this can take a minute' : 'Confirming your enrollment…'}</h2>
    {fulfilled ? <LinkButton className="mt-4" to={`/materials?cohort_id=${result.cohort.id}`}>Open {result.cohort.name}</LinkButton>
      : <>
        <p className="mt-2 text-sm text-slate-600">{problem ? 'Contact CSG to check your purchase and course access.' : 'Please wait for confirmation before making another payment.'}</p>
        {!isSignedIn && <LinkButton className="mt-4" to={`/sign-in?checkout=return&purchase_id=${encodeURIComponent(purchaseId)}`}>Sign in to check enrollment</LinkButton>}
        {(stopped || problem) && isSignedIn && purchaseId && <Button className="mt-4" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
        <a className="ml-4 inline-flex min-h-11 items-center text-sm font-semibold text-ruby-700 underline" href="mailto:codeschoolofguam@gmail.com">Contact support</a>
      </>}
  </section>
}

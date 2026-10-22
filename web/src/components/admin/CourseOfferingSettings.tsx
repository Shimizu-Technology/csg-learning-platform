import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle, Circle } from 'lucide-react'
import { api } from '../../lib/api'
import type { CohortInstructorAssignment, CourseOfferingTerms } from '../../types/api'
import { Button } from '../ui/Button'

const checklist = {
  curriculum_assigned: 'Active curriculum assigned',
  price_set: 'Display price and Stripe price ID set',
  support_instructor_set: 'Active support instructor assigned to this cohort',
  published_content: 'Selected modules contain a published lesson with content',
  cohort_active: 'Cohort is active',
}

export function CourseOfferingSettings({ cohort, onSaved }: {
  cohort: CourseOfferingTerms & { id: number }
  onSaved: () => Promise<unknown>
}) {
  const [price, setPrice] = useState(cohort.public_price_cents == null ? '' : (cohort.public_price_cents / 100).toFixed(2))
  const [stripePrice, setStripePrice] = useState(cohort.stripe_price_id || '')
  const [instructor, setInstructor] = useState(String(cohort.support_instructor_id || ''))
  const [months, setMonths] = useState(String(cohort.self_paced_access_months))
  const [weeks, setWeeks] = useState(String(cohort.self_paced_support_weeks))
  const [visible, setVisible] = useState(cohort.public_checkout_enabled)
  const [instructors, setInstructors] = useState<CohortInstructorAssignment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.getCohortInstructorAssignments(cohort.id).then((response) => {
      if (!active) return
      if (response.data && !response.error && !response.fromCache) {
        setInstructors(response.data.instructors)
        setLoaded(true)
      } else setError('Could not load assigned instructors. Refresh before saving.')
    }).catch(() => { if (active) setError('Could not load assigned instructors. Refresh before saving.') })
    return () => { active = false }
  }, [cohort.id])

  const priceCents = Math.round(Number(price) * 100)
  const readiness = {
    ...cohort.offering_readiness,
    price_set: priceCents > 0 && /^price_[a-zA-Z0-9_]+$/.test(stripePrice.trim()),
    support_instructor_set: instructors.some((entry) => String(entry.id) === instructor),
  }
  const ready = Object.values(readiness).every(Boolean)
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await api.updateCohort(cohort.id, {
        public_price_cents: price ? priceCents : null,
        stripe_price_id: stripePrice.trim() || null,
        support_instructor_id: instructor ? Number(instructor) : null,
        self_paced_access_months: Number(months), self_paced_support_weeks: Number(weeks),
        public_checkout_enabled: visible && ready,
      })
      if (response.error || !response.data) setError(response.error || 'Could not save course offering.')
      else { setVisible(response.data.cohort.public_checkout_enabled ?? false); setMessage('Course offering saved.'); await onSaved() }
    } catch { setError('Could not save course offering. Please try again.') }
    finally { setBusy(false) }
  }
  return <section className="mt-4 rounded-2xl border border-line p-5" aria-labelledby="course-offering-heading">
    <h2 id="course-offering-heading" className="text-lg font-bold text-ink">Course offering</h2>
    <p className="mt-2 text-sm text-ink-secondary">These defaults apply to new checkout attempts. Open and paid purchases keep their agreed terms. Existing purchasers keep their agreed access dates and support duration, including courses they have not opened yet.</p>
    <form onSubmit={(event) => void save(event)} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Display price (USD)<input className="app-control mt-1 w-full" type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <label className="text-sm font-semibold">Stripe price ID<input className="app-control mt-1 w-full" pattern="price_[a-zA-Z0-9_]+" placeholder="price_…" value={stripePrice} onChange={(event) => setStripePrice(event.target.value)} /></label>
        <label className="text-sm font-semibold">Support instructor<select className="app-control mt-1 w-full" value={instructor} onChange={(event) => setInstructor(event.target.value)} disabled={!loaded}><option value="">Choose an assigned instructor</option>{instructors.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name || entry.email}</option>)}</select></label>
        <label className="text-sm font-semibold">Lesson access (months)<input className="app-control mt-1 w-full" required type="number" min="1" step="1" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
        <label className="text-sm font-semibold">Instructor support (weeks)<input className="app-control mt-1 w-full" required type="number" min="1" step="1" value={weeks} onChange={(event) => setWeeks(event.target.value)} /></label>
      </div>
      <div><h3 className="text-sm font-bold">Checkout readiness</h3><ul className="mt-2 space-y-2">{Object.entries(checklist).map(([key, label]) => {
        const complete = readiness[key as keyof typeof readiness]
        const Icon = complete ? CheckCircle : Circle
        return <li key={key} className="flex items-start gap-2 text-sm"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${complete ? 'text-green-700' : 'text-ink-muted'}`} aria-hidden="true" /><span>{complete ? 'Ready: ' : 'Needed: '}{label}</span></li>
      })}</ul></div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={visible} disabled={!ready || !loaded} onChange={(event) => setVisible(event.target.checked)} />Show checkout in the course catalog</label>
      <p className="text-sm text-ink-secondary">Checkout is off by default. Complete the checklist before showing it. School-wide sales controls must also be enabled separately.</p>
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      <Button type="submit" disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save course offering'}</Button>
    </form>
  </section>
}

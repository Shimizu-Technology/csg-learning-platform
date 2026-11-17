import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
  catalog_copy: 'Public title, description and image set',
  school_checkout_enabled: 'School checkout is on',
}

export function CourseOfferingSettings({ cohort, onSaved, onDraftChange }: {
  cohort: CourseOfferingTerms & { id: number }
  onDraftChange?: (patch: Record<string, unknown>) => void
  onSaved: () => Promise<unknown>
}) {
  const location = useLocation()
  const [marketing, setMarketing] = useState(() => Object.fromEntries(['public_title', 'public_description', 'public_image_url', 'public_outcomes', 'public_duration', 'public_prerequisites', 'public_preview'].map(key => [key, String(cohort[key as keyof typeof cohort] || '')])))
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
      } else setError('Could not load assigned instructors. Course copy can still be saved; refresh to edit the instructor or checkout.')
    }).catch(() => { if (active) setError('Could not load assigned instructors. Course copy can still be saved; refresh to edit the instructor or checkout.') })
    return () => { active = false }
  }, [cohort.id])

  const priceCents = Math.round(Number(price) * 100)
  const readiness = {
    ...cohort.offering_readiness,
    price_set: priceCents > 0 && /^price_[a-zA-Z0-9_]+$/.test(stripePrice.trim()),
    support_instructor_set: instructors.some((entry) => String(entry.id) === instructor),
  }
  const [serverReadiness, setServerReadiness] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    let active = true
    setServerReadiness(null)
    const timer = setTimeout(() => {
      void api.getSetupReadiness(cohort.id, { ...marketing, public_price_cents: price ? priceCents : null, stripe_price_id: stripePrice.trim() || null, support_instructor_id: instructor ? Number(instructor) : null }).then(r => {
        if (active && r.data && !r.error && !r.fromCache) setServerReadiness(r.data.readiness)
      }).catch(() => { if (active) setError('Readiness unavailable. Refresh before publishing.') })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [cohort.id, price, priceCents, stripePrice, instructor, marketing])
  const ready = serverReadiness !== null && Object.values(serverReadiness).every(Boolean)
  useEffect(() => {
    if (!onDraftChange) return
    const patch = { ...marketing, public_price_cents: price ? priceCents : null, stripe_price_id: stripePrice.trim() || null, support_instructor_id: instructor ? Number(instructor) : null, self_paced_access_months: Number(months), self_paced_support_weeks: Number(weeks), public_checkout_enabled: visible }
    onDraftChange(Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== ((cohort as unknown as Record<string, unknown>)[key] ?? (key.startsWith('public_') && key !== 'public_price_cents' && key !== 'public_checkout_enabled' ? '' : null)) && !(key === 'stripe_price_id' && value === (cohort.stripe_price_id || null)))))
  }, [price, priceCents, stripePrice, instructor, months, weeks, visible, ready, cohort, onDraftChange, loaded, marketing])
  const Form = onDraftChange ? 'div' : 'form'
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await api.updateCohort(cohort.id, {
        ...marketing,
        public_price_cents: price ? priceCents : null,
        stripe_price_id: stripePrice.trim() || null,
        support_instructor_id: instructor ? Number(instructor) : null,
        self_paced_access_months: Number(months), self_paced_support_weeks: Number(weeks),
        ...(visible !== cohort.public_checkout_enabled ? { public_checkout_enabled: visible } : {}),
      })
      if (response.error || !response.data) setError(response.error || 'Could not save course offering.')
      else { setVisible(response.data.cohort.public_checkout_enabled ?? false); setMessage('Course offering saved.'); await onSaved() }
    } catch { setError('Could not save course offering. Please try again.') }
    finally { setBusy(false) }
  }
  return <section className="mt-4 rounded-2xl border border-line p-5" aria-labelledby="course-offering-heading">
    <h2 id="course-offering-heading" className="text-lg font-bold text-ink">Course offering</h2>
    <Link className="app-link inline-flex min-h-11 items-center" to={`/courses?offering_id=${cohort.id}`}>View in catalog</Link>
    <p className="mt-2 text-sm text-ink-secondary">These defaults apply to new checkout attempts. Open and paid purchases keep their agreed terms. Existing purchasers keep their agreed access dates and support duration, including courses they have not opened yet.</p>
    <Form onSubmit={(event) => void save(event)} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries({ public_title: 'Public title', public_description: 'Description', public_image_url: 'Image URL (HTTPS)', public_outcomes: 'What learners will learn', public_duration: 'Estimated duration', public_prerequisites: 'Prerequisites', public_preview: 'Course preview' }).map(([key, label]) => <label key={key} className="text-sm font-semibold sm:col-span-2">{label}{['public_description', 'public_outcomes', 'public_prerequisites', 'public_preview'].includes(key) ? <textarea className="app-control mt-1 w-full" value={marketing[key]} onChange={e => setMarketing(v => ({ ...v, [key]: e.target.value }))} /> : <input className="app-control mt-1 w-full" type={key === 'public_image_url' ? 'url' : 'text'} value={marketing[key]} onChange={e => setMarketing(v => ({ ...v, [key]: e.target.value }))} />}</label>)}
        <p className="text-sm text-ink-secondary sm:col-span-2">Use public course copy only. The lesson count and syllabus come from published lessons in the selected modules. The course address stays the same when you change its title.</p>
        <label className="text-sm font-semibold">Display price (USD)<input id="offering-price" className="app-control mt-1 w-full" type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <label className="text-sm font-semibold">Stripe price ID<input className="app-control mt-1 w-full" pattern="price_[a-zA-Z0-9_]+" placeholder="price_…" value={stripePrice} onChange={(event) => setStripePrice(event.target.value)} /></label>
        <p className="text-sm text-ink-secondary sm:col-span-2">Use a Stripe Price ID beginning with price_, such as price_example123. Product IDs beginning with prod_ will not work.</p>
        {loaded && instructors.length === 0 && <p className="text-sm sm:col-span-2">Assign an instructor to this cohort first. <Link className="app-link" to={`/admin/cohorts/${cohort.id}?tab=team`}>Open Teaching team</Link></p>}
        <label className="text-sm font-semibold">Support instructor<select className="app-control mt-1 w-full" value={instructor} onChange={(event) => setInstructor(event.target.value)} disabled={!loaded}><option value="">Choose an assigned instructor</option>{instructors.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name || entry.email}</option>)}</select></label>
        <label className="text-sm font-semibold">Lesson access (months)<input className="app-control mt-1 w-full" required type="number" min="1" step="1" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
        <label className="text-sm font-semibold">Help period (weeks)<input className="app-control mt-1 w-full" required type="number" min="1" step="1" value={weeks} onChange={(event) => setWeeks(event.target.value)} /></label>
      </div>
      <div><h3 className="text-sm font-bold">Checkout readiness</h3><ul className="mt-2 space-y-2">{Object.entries(checklist).map(([key, label]) => {
        const complete = (serverReadiness ?? readiness)[key as keyof typeof readiness]
        const Icon = complete ? CheckCircle : Circle
        return <li key={key} className="flex items-start gap-2 text-sm"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${complete ? 'text-success-ink' : 'text-ink-muted'}`} aria-hidden="true" /><Link className="app-link min-h-11 inline-flex items-center" onClick={() => { if (key === 'cohort_active' || !['support_instructor_set', 'published_content', 'curriculum_assigned'].includes(key)) { const target = document.getElementById(key === 'cohort_active' ? 'cohort-status' : 'offering-price'); target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true }) } }} to={key === 'support_instructor_set' ? `/admin/cohorts/${cohort.id}?tab=team` : key === 'published_content' || key === 'curriculum_assigned' ? `/admin/content?open=${(cohort as { modules?: Array<{ id: number }> }).modules?.map(module => module.id).join(',') || ''}` : key === 'cohort_active' ? `${location.pathname}${location.search}#cohort-status` : `${location.pathname}${location.search}#offering-price`}>{complete ? 'Ready: ' : 'Needed: '}{label}</Link></li>
      })}</ul></div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={visible} disabled={(!ready && !visible) || !loaded} onChange={(event) => setVisible(event.target.checked)} />Show checkout in the course catalog</label>
      <p className="text-sm text-ink-secondary">Checkout is off by default. Complete the checklist before showing it. School-wide sales controls must also be enabled separately.</p>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      {message && <p role="status" className="text-sm text-success-ink">{message}</p>}
      {!onDraftChange && <Button type="submit" disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save course offering'}</Button>}
    </Form>
  </section>
}

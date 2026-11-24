import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CheckCircle, Circle } from 'lucide-react'
import { api } from '../../lib/api'
import { listLinkState } from '../../lib/navigationContext'
import { offeringPath } from '../../lib/routes'
import type { CohortInstructorAssignment, CourseOfferingTerms } from '../../types/api'
import type { components } from '../../types/api.generated'
import { Button } from '../ui/Button'

const checklist = {
  curriculum_assigned: 'Active curriculum assigned',
  price_set: 'Display price and Stripe price ID set',
  price_verified: 'Price verified in Stripe',
  support_instructor_set: 'Active support instructor assigned to this cohort',
  published_content: 'Selected modules contain a published lesson with content',
  cohort_active: 'Cohort is active',
  catalog_copy: 'Public title, description and image set',
  school_checkout_enabled: 'School checkout is on',
}
const readinessTargets: Partial<Record<keyof typeof checklist, string>> = {
  price_set: 'offering-price',
  price_verified: 'offering-stripe-price',
  cohort_active: 'cohort-status',
  catalog_copy: 'offering-public-title',
  school_checkout_enabled: 'offering-school-checkout',
}

export function CourseOfferingSettings({ cohort, courseDelivery = 'self_paced', onSaved, onDraftChange }: {
  cohort: CourseOfferingTerms & { id: number }
  courseDelivery?: 'program' | 'guided' | 'self_paced'
  onDraftChange?: (patch: Record<string, unknown>) => void
  onSaved: () => Promise<unknown>
}) {
  const location = useLocation()
  const isGuided = courseDelivery === 'guided'
  const [marketing, setMarketing] = useState(() => Object.fromEntries(['public_title', 'public_description', 'public_image_url', 'public_outcomes', 'public_duration', 'public_prerequisites', 'public_preview'].map(key => [key, String(cohort[key as keyof typeof cohort] || '')])))
  const [price, setPrice] = useState(cohort.public_price_cents == null ? '' : (cohort.public_price_cents / 100).toFixed(2))
  const [stripePrice, setStripePrice] = useState(cohort.stripe_price_id || '')
  const [instructor, setInstructor] = useState(String(cohort.support_instructor_id || ''))
  const [months, setMonths] = useState(String(cohort.self_paced_access_months))
  const [weeks, setWeeks] = useState(String(cohort.self_paced_support_weeks))
  const [seatLimit, setSeatLimit] = useState(cohort.seat_limit == null ? '' : String(cohort.seat_limit))
  const [visible, setVisible] = useState(cohort.public_checkout_enabled)
  const [unlisted, setUnlisted] = useState(cohort.unlisted ?? false)
  const [instructors, setInstructors] = useState<CohortInstructorAssignment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [verification, setVerification] = useState(cohort.offering_price_verified ?? null)
  const [verifying, setVerifying] = useState(false)
  const [priceError, setPriceError] = useState('')
  useEffect(() => {
    let active = true
    const request = typeof api.getCohortInstructorAssignments === 'function' ? api.getCohortInstructorAssignments(cohort.id) : null
    if (!request) return () => { active = false }
    request.then((response) => {
      if (!active) return
      if (response.data && !response.error && !response.fromCache) {
        setInstructors(response.data.instructors)
        setLoaded(true)
      } else setError('Could not load assigned instructors. Course copy can still be saved; refresh to edit the instructor or checkout.')
    }).catch(() => { if (active) setError('Could not load assigned instructors. Course copy can still be saved; refresh to edit the instructor or checkout.') })
    return () => { active = false }
  }, [cohort.id])

  const trimmedSeatLimit = seatLimit.trim()
  const seatLimitInvalid = trimmedSeatLimit !== '' && (!/^\d+$/.test(trimmedSeatLimit) || Number(trimmedSeatLimit) < 1)
  const parsedSeatLimit = trimmedSeatLimit === '' ? null : seatLimitInvalid ? Number.NaN : Number(trimmedSeatLimit)

  const priceCents = Math.round(Number(price) * 100)
  const stripePriceId = stripePrice.trim() || null
  const savedPrice = stripePriceId === (cohort.stripe_price_id || null) && priceCents === cohort.public_price_cents
  const priceSet = priceCents > 0 && stripePriceId !== null && /^price_[a-zA-Z0-9_]+$/.test(stripePriceId)
  const priceVerified = Boolean(verification && verification.price_cents === priceCents && verification.stripe_price_id === stripePriceId)
  const savedPriceVerified = verification?.price_cents === cohort.public_price_cents && verification?.stripe_price_id === cohort.stripe_price_id
  const formattedPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceCents / 100)
  const readiness = {
    ...cohort.offering_readiness,
    price_set: priceSet,
    price_verified: priceVerified,
    support_instructor_set: instructors.some((entry) => String(entry.id) === instructor),
  }
  const [serverReadiness, setServerReadiness] = useState<Record<string, boolean> | null>(null)
  const [schoolCheckout, setSchoolCheckout] = useState<components['schemas']['SetupReadinessResponse']['school_checkout'] | null>(null)
  useEffect(() => {
    let active = true
    setServerReadiness(null)
    const timer = setTimeout(() => {
      if (typeof api.getSetupReadiness !== 'function') return
      const req = api.getSetupReadiness(cohort.id, { ...marketing, course_delivery: courseDelivery, public_price_cents: price ? priceCents : null, stripe_price_id: stripePrice.trim() || null, support_instructor_id: instructor ? Number(instructor) : null })
      if (!req) return
      void req.then(r => {
        if (active && r.data && !r.error && !r.fromCache) {
          setServerReadiness(r.data.readiness)
          setSchoolCheckout(r.data.school_checkout)
        }
      }).catch(() => { if (active) setError('Readiness unavailable. Refresh before publishing.') })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [cohort.id, courseDelivery, price, priceCents, stripePrice, instructor, marketing, verification])
  const ready = priceVerified && serverReadiness !== null && Object.values(serverReadiness).every(Boolean)
  useEffect(() => {
    if (!onDraftChange) return
    const patch: Record<string, unknown> = {
      ...marketing,
      public_price_cents: price ? priceCents : null,
      stripe_price_id: stripePrice.trim() || null,
      support_instructor_id: instructor ? Number(instructor) : null,
      ...(!isGuided ? { self_paced_access_months: Number(months), self_paced_support_weeks: Number(weeks) } : {}),
      seat_limit: parsedSeatLimit,
      public_checkout_enabled: visible && (cohort.public_checkout_enabled || priceVerified),
      unlisted,
    }
    const baseline = (key: string) => {
      if (key === 'seat_limit') return cohort.seat_limit ?? null
      if (key === 'unlisted') return cohort.unlisted ?? false
      if (key === 'stripe_price_id') return cohort.stripe_price_id || null
      return (cohort as unknown as Record<string, unknown>)[key] ?? (key.startsWith('public_') && key !== 'public_price_cents' && key !== 'public_checkout_enabled' ? '' : null)
    }
    onDraftChange(Object.fromEntries(Object.entries(patch).filter(([key, value]) => !Object.is(value, baseline(key)))))
  }, [price, priceCents, stripePrice, instructor, months, weeks, parsedSeatLimit, visible, unlisted, isGuided, priceVerified, cohort, onDraftChange, marketing])
  const Form = onDraftChange ? 'div' : 'form'
  function editPrice(setValue: (value: string) => void, value: string) {
    setValue(value)
    setPriceError('')
    if (!cohort.public_checkout_enabled) setVisible(false)
  }

  async function verifyPrice() {
    setVerifying(true)
    setPriceError('')
    try {
      const response = await api.verifyOfferingPrice(cohort.id)
      const stamp = response.data?.offering_price_verified
      if (response.error || !stamp) {
        setPriceError(response.error || 'Could not verify this price. Try again.')
      } else if (stamp.stripe_price_id !== stripePriceId || stamp.price_cents !== priceCents) {
        setPriceError('The saved price has changed. Reload settings and try again.')
      } else {
        setVerification(stamp)
      }
    } catch {
      setPriceError('Could not verify this price. Try again.')
    } finally {
      setVerifying(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (seatLimitInvalid) {
      setError('Seat limit must be a whole number of at least 1, or blank for unlimited.')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await api.updateCohort(cohort.id, {
        ...marketing,
        public_price_cents: price ? priceCents : null,
        stripe_price_id: stripePrice.trim() || null,
        support_instructor_id: instructor ? Number(instructor) : null,
        ...(!isGuided ? { self_paced_access_months: Number(months), self_paced_support_weeks: Number(weeks) } : {}),
        seat_limit: parsedSeatLimit,
        ...(visible !== cohort.public_checkout_enabled ? { public_checkout_enabled: visible } : {}),
        ...(unlisted !== (cohort.unlisted ?? false) ? { unlisted } : {}),
      })
      if (response.error || !response.data) setError(response.error || 'Could not save course offering.')
      else {
        setVerification(response.data.cohort.offering_price_verified ?? null)
        setVisible(response.data.cohort.public_checkout_enabled ?? false)
        setUnlisted(response.data.cohort.unlisted ?? false)
        setMessage('Course offering saved.')
        await onSaved()
      }
    } catch { setError('Could not save course offering. Please try again.') }
    finally { setBusy(false) }
  }
  const directCoursePath = cohort.public_slug ? `/courses/${cohort.public_slug}` : `/courses?offering_id=${cohort.id}`
  return <section className="mt-4 rounded-2xl border border-line p-5" aria-labelledby="course-offering-heading">
    <h2 id="course-offering-heading" className="text-lg font-bold text-ink">Course offering</h2>
    <div className="flex flex-wrap gap-x-4">
      <Link className="app-link inline-flex min-h-11 items-center" to={unlisted && cohort.public_slug ? directCoursePath : `/courses?offering_id=${cohort.id}`}>{unlisted && cohort.public_slug ? 'Open direct course link' : 'View in catalog'}</Link>
      {/* Purchases and the enrollments they gave (L-3.2). */}
      <Link className="app-link inline-flex min-h-11 items-center" to={offeringPath(cohort.id)} state={listLinkState(location, 'Settings')}>Purchases</Link>
    </div>
    <p className="mt-2 text-sm text-ink-secondary">These defaults apply to new checkout attempts. Open and paid purchases keep their agreed terms. Existing purchasers keep their agreed access dates and support duration, including courses they have not opened yet.</p>
    <Form onSubmit={(event) => void save(event)} className="mt-4 space-y-4 max-lg:[&_input]:text-base max-lg:[&_select]:text-base max-lg:[&_textarea]:text-base">
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries({ public_title: 'Public title', public_description: 'Description', public_image_url: 'Image URL (HTTPS)', public_outcomes: 'What learners will learn', public_duration: 'Estimated duration', public_prerequisites: 'Prerequisites', public_preview: 'Course preview' }).map(([key, label]) => <label key={key} className="text-sm font-semibold sm:col-span-2">{label}{['public_description', 'public_outcomes', 'public_prerequisites', 'public_preview'].includes(key) ? <textarea className="app-control mt-1 w-full" value={marketing[key]} onChange={e => setMarketing(v => ({ ...v, [key]: e.target.value }))} /> : <input id={key === 'public_title' ? readinessTargets.catalog_copy : undefined} className="app-control mt-1 w-full" type={key === 'public_image_url' ? 'url' : 'text'} value={marketing[key]} onChange={e => setMarketing(v => ({ ...v, [key]: e.target.value }))} />}</label>)}
        <p className="text-sm text-ink-secondary sm:col-span-2">Use public course copy only. The lesson count and syllabus come from published lessons in the selected modules. The course address stays the same when you change its title.</p>
        <label className="min-w-0 text-sm font-semibold">Display price (USD)<input id="offering-price" className="app-control mt-1 min-h-11 w-full" type="number" min="0.01" step="0.01" value={price} disabled={verifying} onChange={(event) => editPrice(setPrice, event.target.value)} /></label>
        <div className="grid min-w-0 gap-2">
          <label className="text-sm font-semibold">Stripe price ID<input id="offering-stripe-price" className="app-control mt-1 min-h-11 w-full" pattern="\s*price_[a-zA-Z0-9_]+\s*" placeholder="price_…" value={stripePrice} disabled={verifying} aria-describedby="offering-price-help" onChange={(event) => editPrice(setStripePrice, event.target.value)} /></label>
          {priceVerified ? (
            <p role="status" className="flex w-fit items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">
              <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />Verified in Stripe · {formattedPrice} USD
            </p>
          ) : (
            <Button variant="secondary" className="min-h-11 justify-self-start" disabled={!savedPrice || !priceSet || verifying || busy} onClick={() => void verifyPrice()}>
              {verifying ? 'Verifying price…' : 'Verify price in Stripe'}
            </Button>
          )}
          <p id="offering-price-help" className="text-sm text-ink-secondary">
            {priceVerified ? 'One-time payment.' : priceSet && !savedPrice
              ? `Save ${onDraftChange ? 'settings' : 'the course offering'} to verify this price.`
              : 'Use an active, one-time USD Price ID beginning with price_.'}
          </p>
          {priceError && <p role="alert" className="text-sm text-danger-ink">{priceError}</p>}
        </div>
        {loaded && instructors.length === 0 && <p className="text-sm sm:col-span-2">Assign an instructor to this cohort first. <Link className="app-link" to={`/admin/cohorts/${cohort.id}?tab=team`}>Open Teaching team</Link></p>}
        <label className="text-sm font-semibold">Support instructor<select className="app-control mt-1 min-h-11 w-full" value={instructor} onChange={(event) => setInstructor(event.target.value)} disabled={!loaded}><option value="">Choose an assigned instructor</option>{instructors.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name || entry.email}</option>)}</select></label>
        <label className="text-sm font-semibold">
          Paid checkout seat limit
          <input
            id="offering-seat-limit"
            className="app-control mt-1 min-h-11 w-full"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            placeholder="Unlimited"
            aria-describedby="offering-seat-limit-help"
            aria-invalid={seatLimitInvalid || undefined}
            value={seatLimit}
            onChange={(event) => setSeatLimit(event.target.value)}
          />
          <span id="offering-seat-limit-help" className="mt-1 block text-xs font-normal leading-5 text-ink-secondary">
            Leave blank for unlimited seats. Counts active, unexpired paused, and unexpired completed enrollments plus open checkout holds. Staff enrollment can still add learners over this limit; paid checkout stops when full.
            {cohort.seat_limit != null && cohort.seats_taken != null ? (
              <>
                {' '}Currently <strong>{cohort.seats_taken} of {cohort.seat_limit}</strong> seats occupied
                {typeof cohort.occupied_enrollments_count === 'number' && typeof cohort.pending_checkouts_count === 'number'
                  ? ` (${cohort.occupied_enrollments_count} enrollments, ${cohort.pending_checkouts_count} open checkouts)`
                  : ''}
                {cohort.sold_out ? ' — full' : ''}.
              </>
            ) : typeof cohort.seats_taken === 'number' && cohort.seats_taken > 0 ? (
              <> Currently {cohort.seats_taken} occupied.</>
            ) : null}
          </span>
          {seatLimitInvalid && <span role="alert" className="mt-1 block text-xs font-medium text-danger-ink">Enter a whole number of at least 1, or leave blank for unlimited.</span>}
        </label>
        {!isGuided && <>
          <label className="text-sm font-semibold">Lesson access (months)<input className="app-control mt-1 min-h-11 w-full" required type="number" min="1" step="1" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
          <label className="text-sm font-semibold">Help period (weeks)<input className="app-control mt-1 min-h-11 w-full" required type="number" min="1" step="1" value={weeks} onChange={(event) => setWeeks(event.target.value)} /></label>
        </>}
      </div>
      <div><h3 className="text-sm font-bold">Checkout readiness</h3><ul className="mt-2 space-y-2">{(Object.keys(checklist) as Array<keyof typeof checklist>).map((key) => {
        const complete = key === 'price_verified' ? priceVerified : (serverReadiness ?? readiness)[key as keyof typeof readiness]
        const Icon = complete ? CheckCircle : Circle
        const targetId = readinessTargets[key]
        const to = targetId ? `${location.pathname}${location.search}#${targetId}`
          : key === 'support_instructor_set' ? `/admin/cohorts/${cohort.id}?tab=team`
            : `/admin/content?open=${(cohort as { modules?: Array<{ id: number }> }).modules?.map(module => module.id).join(',') || ''}`
        return <li key={key} className="flex items-start gap-2 text-sm">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${complete ? 'text-success-ink' : 'text-ink-muted'}`} aria-hidden="true" />
          <Link className="app-link min-h-11 inline-flex items-center" to={to} onClick={targetId ? (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = document.getElementById(targetId)
            target?.scrollIntoView({ block: 'center' })
            target?.focus({ preventScroll: true })
          } : undefined}>{complete ? 'Ready: ' : 'Needed: '}{checklist[key]}</Link>
        </li>
      })}</ul></div>
      <div id={readinessTargets.school_checkout_enabled} tabIndex={-1} className="rounded-2xl border border-line p-3 text-sm">
        <h4 className="font-semibold">School checkout status</h4>
        {schoolCheckout ? <>
          <p>School checkout is {schoolCheckout.enabled ? 'on' : 'off'}.</p>
          {!schoolCheckout.enabled && <p className="mt-1 text-ink-secondary">
            {schoolCheckout.stripe_configured ? 'Stripe is configured.' : 'Stripe needs to be configured.'}{' '}
            {schoolCheckout.webhook_configured ? 'The payment webhook is configured.' : 'The payment webhook needs to be configured.'}{' '}
            Ask a school administrator to check the school-wide sales settings.
          </p>}
        </> : <p className="text-ink-secondary">School checkout status is unavailable.</p>}
      </div>
      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={visible} disabled={(!ready && !visible) || !loaded} onChange={(event) => setVisible(event.target.checked)} />{unlisted ? 'Enable in-app checkout (direct link only)' : 'Show checkout in the course catalog'}</label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input id="offering-unlisted" type="checkbox" className="h-5 w-5" checked={unlisted} onChange={(event) => setUnlisted(event.target.checked)} />Unlisted — hide from the public catalog list (direct link only)</label>
      </div>
      <p className="text-sm text-ink-secondary">
        {cohort.public_checkout_enabled && !savedPriceVerified && 'New checkout attempts are paused until you verify the saved price. '}
        Checkout is off by default. Complete the checklist before enabling it. School-wide sales controls must also be enabled separately.
        {unlisted && cohort.public_slug ? ` Invited learners can still open and enroll at /courses/${cohort.public_slug}.` : ''}
      </p>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      {message && <p role="status" className="text-sm text-success-ink">{message}</p>}
      {!onDraftChange && <Button type="submit" disabled={busy || verifying || !loaded || seatLimitInvalid}>{busy ? 'Saving…' : 'Save course offering'}</Button>}
    </Form>
  </section>
}

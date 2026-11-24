import { reviewTiming } from '../lib/reviewCopy'
import { usePublicCatalogAvailability } from '../lib/usePublicCatalogAvailability'
import { pageTitle } from '../lib/glossary'
import { brand } from '../lib/brand'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpenText, CalendarDays, Clock3, MessageCircle, Users } from 'lucide-react'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { Button, LinkButton } from '../components/ui/Button'
import { api } from '../lib/api'
import { useAuthContext } from '../contexts/AuthContext'
import { CourseCheckoutStatus } from '../components/courses/CourseCheckoutStatus'
import { CommunityStandardsGate } from '../components/auth/CommunityStandardsGate'
import { courseAuthPath, offeringIdFrom, validOfferingSlug } from '../lib/courseIntent'
import { SCHOOL_COURSES_URL } from '../lib/brand'
import { hasCourseAccess } from '../lib/courseAccess'
import { formatShortDate } from '../lib/format'

type Offering = NonNullable<Awaited<ReturnType<typeof api.getCourseOfferings>>['data']>['offerings'][number]

function CourseUnavailable() {
  const catalogAvailable = usePublicCatalogAvailability()
  return <div className="flex min-h-svh flex-col bg-brand-cream text-ink"><PublicHeader /><main className="safe-px mx-auto w-full max-w-[1200px] flex-1 py-16"><h1 className="font-display text-4xl">This course isn’t available</h1><p className="mt-5 max-w-xl text-ink-secondary">It may no longer be open for enrollment. Your existing learning is still available when you sign in.</p><LinkButton className="mt-6" to={catalogAvailable ? '/courses' : '/sign-in'}>{catalogAvailable ? 'Browse courses' : 'Sign in'}</LinkButton></main><PublicFooter /></div>
}

export function CourseCatalog() {
  const { isSignedIn, user, enrollments, syncSession, signOut } = useAuthContext()
  const [searchParams] = useSearchParams()
  const { slug } = useParams()
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)
  const [pendingCommunityCheckout, setPendingCommunityCheckout] = useState<{ cohortId: number; version: string } | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [pending, setPending] = useState<Array<{ id: number; cohort_id: number }> | null>(null)
  const [purchaseError, setPurchaseError] = useState(false)
  const [purchaseReloadKey, setPurchaseReloadKey] = useState(0)
  const returning = searchParams.get('checkout') === 'return'
  const selectedId = offeringIdFrom(searchParams.toString())

  useEffect(() => {
    let active = true
    setLoading(true); setOfferings([]); setError(null); setNotFound(false)
    const request = slug
      ? api.getCourseOffering(slug).then(result => ({ ...result, data: result.data ? { offerings: [result.data.offering] } : null }))
      : api.getCourseOfferings()
    request.then((result) => {
      if (!active) return
      setOfferings(result.data?.offerings || [])
      setNotFound(result.status === 404)
      setError(result.error ? (result.status === 404 ? 'This course is not currently listed.' : 'Course listings could not load right now.') : null)
    }).catch(() => { if (active) setError('Course listings could not load right now.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reloadKey, slug])

  useEffect(() => {
    if (!isSignedIn || !user || user.is_staff) return
    let active = true
    setPurchaseError(false)
    api.getPendingCoursePurchases().then((result) => {
      if (!active) return
      if (result.data && !result.error) setPending(result.data.purchases)
      else setPurchaseError(true)
    }).catch(() => { if (active) setPurchaseError(true) })
    return () => { active = false }
  }, [isSignedIn, user?.id, user?.is_staff, purchaseReloadKey])

  const isUnlistedOffering = Boolean(slug && offerings[0]?.unlisted)

  useEffect(() => {
    if (slug && !loading) {
      document.title = pageTitle(returning && notFound ? 'Enrollment confirmation' : notFound ? 'Course unavailable' : offerings[0]?.name || 'Course')
    }
  }, [slug, loading, notFound, returning, offerings])

  // Static SPA hosting on Netlify (no Edge Functions): unlisted offerings stay
  // excluded from the public catalog/sitemap, emit X-Robots-Tag on the offering
  // API, and inject a noindex, nofollow meta tag in <head> while mounted.
  useEffect(() => {
    if (!isUnlistedOffering) return
    const existing = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null
    const previousContent = existing?.getAttribute('content') ?? null
    const meta = existing || document.createElement('meta')
    meta.setAttribute('name', 'robots')
    meta.setAttribute('content', 'noindex, nofollow')
    if (!existing) document.head.appendChild(meta)
    return () => {
      if (existing) {
        if (previousContent === null) existing.removeAttribute('content')
        else existing.setAttribute('content', previousContent)
      } else {
        meta.remove()
      }
    }
  }, [isUnlistedOffering])

  const requireCommunityStandardsForCheckout = (cohortId: number, version: string) => {
    setPendingCommunityCheckout({ cohortId, version })
  }

  const runCheckout = async (cohortId: number) => {
    setCheckingOut(cohortId)
    setError(null)
    try {
      const result = await api.startCourseCheckout(cohortId)
      if (result.data?.url) {
        window.location.assign(result.data.url)
        return
      }
      if (result.errorCode === 'community_terms_required') {
        setPendingCommunityCheckout({
          cohortId,
          version: user?.community_policy?.version || '2026-08-17',
        })
        return
      }
      setError(result.error || 'Checkout could not start. Please try again.')
      if (result.status === 409) setReloadKey((key) => key + 1)
    } finally {
      setCheckingOut(null)
    }
  }

  const startCheckout = async (cohortId: number) => {
    if (user?.community_policy && !user.community_policy.accepted) {
      setPendingCommunityCheckout({ cohortId, version: user.community_policy.version })
      return
    }
    await runCheckout(cohortId)
  }

  if (pendingCommunityCheckout && user) {
    return (
      <CommunityStandardsGate
        version={pendingCommunityCheckout.version}
        accountEmail={user.email}
        onSignOut={signOut}
        onAccepted={async () => {
          const synced = await syncSession()
          const cohortId = pendingCommunityCheckout.cohortId
          setPendingCommunityCheckout(null)
          if (synced) await runCheckout(cohortId)
        }}
      />
    )
  }

  if (slug && notFound && !returning) return <CourseUnavailable />

  const validatedSlug = validOfferingSlug(slug)
  const signInParams = new URLSearchParams(searchParams)
  if (validatedSlug) {
    signInParams.set('offering_slug', validatedSlug)
  }
  if (slug && offerings[0]) {
    signInParams.set('offering_id', String(offerings[0].id))
    const offeringSlug = validOfferingSlug(offerings[0].slug)
    if (offeringSlug) signInParams.set('offering_slug', offeringSlug)
  }
  const signInPath = validatedSlug || (slug && offerings[0])
    ? `/sign-in?${signInParams}`
    : courseAuthPath('/sign-in', searchParams.toString())
  const visibleOfferings = offerings.filter((offering) => !selectedId || !offerings.some((entry) => entry.id === selectedId) || offering.id === selectedId)
  const isCanceled = searchParams.get('checkout') === 'canceled'
  const hasInlineCanceledStatus = isCanceled && !returning && Boolean(
    isSignedIn && !user?.is_staff && pending && visibleOfferings.some((offering) => {
      const enrolled = enrollments.some((entry) => entry.cohort.id === offering.id && hasCourseAccess(entry))
      return !enrolled && pending.some((purchase) => purchase.cohort_id === offering.id)
    }),
  )

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      <PublicHeader actions={<LinkButton to={isSignedIn ? '/dashboard' : signInPath} variant="quiet" shape="brand" className="px-3 text-ink">{isSignedIn ? 'My learning' : 'Sign in'}</LinkButton>} />
      <main className="safe-px mx-auto w-full max-w-[1200px] flex-1 py-12 lg:py-20">
        <p className="brand-eyebrow">Focused courses</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-medium leading-tight tracking-[-0.03em] sm:text-6xl">{slug ? (returning && notFound ? 'Enrollment confirmation' : offerings[0]?.name || 'Course') : 'Learn one useful skill at a time.'}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-ink-secondary">Study on your schedule, practice what you learn, and get feedback from a real instructor.</p>
        {((slug && offerings[0] && !offerings[0].unlisted) || (!slug && selectedId)) && <LinkButton to="/courses" variant="quiet" className="mt-4">Back to courses</LinkButton>}
        {returning && (
          <CourseCheckoutStatus
            purchaseId={searchParams.get('purchase_id') || ''}
            slug={validatedSlug ?? undefined}
            offeringId={selectedId ?? offerings[0]?.id ?? null}
            onRequireCommunityStandards={requireCommunityStandardsForCheckout}
          />
        )}
        {!returning && selectedId && !loading && !offerings.some((offering) => offering.id === selectedId) && (
          <p role="status" className="mt-8 rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink-secondary">
            This course is not currently listed.{' '}
            <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent('Course enrollment help')}`}>
              Contact {brand.schoolAbbreviation}
            </a>{' '}
            if you need help enrolling.
          </p>
        )}
        {isCanceled && !hasInlineCanceledStatus && <p role="status" className="mt-8 rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink-secondary">Checkout wasn’t completed. If you were charged, contact support before trying again. Otherwise, review your course below whenever you’re ready.</p>}
        {error && offerings.length > 0 && <p role="alert" className="mt-8 rounded-2xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-ink">{error}</p>}
        <div className={`mt-12 grid gap-6 ${slug ? 'max-w-4xl' : 'md:grid-cols-2'}`}>
          {loading && offerings.length === 0 && <p role="status" className="text-sm text-ink-secondary md:col-span-2">Loading courses…</p>}
          {visibleOfferings.map((offering) => {
            const enrolled = enrollments.some((entry) => entry.cohort.id === offering.id && hasCourseAccess(entry))
            const pendingPurchase = pending?.find((purchase) => purchase.cohort_id === offering.id)
            const isGuided = offering.course_delivery === 'guided'
            const hasSeatCap = offering.seat_limit != null
            const soldOut = Boolean(offering.sold_out)
            const offeringSlug = validOfferingSlug(offering.slug)
            const offeringAuthParams = new URLSearchParams({ offering_id: String(offering.id) })
            if (offeringSlug) offeringAuthParams.set('offering_slug', offeringSlug)
            const signUpPath = `/sign-up?${offeringAuthParams}`
            const cardSignInPath = `/sign-in?${offeringAuthParams}`
            const returnCoursePath = offeringSlug ? `/courses/${offeringSlug}` : '/courses'
            const accessLine = isGuided
              ? offering.guided_access_ends_on
                ? `Lesson access through ${formatShortDate(offering.guided_access_ends_on, offering.guided_access_ends_on)}`
                : offering.access_months != null
                  ? `${offering.access_months} months of lesson access from your start`
                  : 'Ongoing lesson access'
              : `${offering.access_months} months of lesson access from confirmed payment`
            const supportLine = isGuided
              ? offering.guided_support_ends_on
                ? `Ask an instructor for help through ${formatShortDate(offering.guided_support_ends_on, offering.guided_support_ends_on)}`
                : offering.instructor_message_weeks != null
                  ? `Ask an instructor for help for ${offering.instructor_message_weeks} weeks from your start`
                  : 'Ask an instructor for help during the course'
              : `Ask an instructor for help for ${offering.instructor_message_weeks} weeks from the day you first open the course.`
            return <article key={offering.id} className="flex flex-col rounded-2xl border border-brand-line bg-surface-raised p-6 sm:p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary-soft text-primary-ink"><BookOpenText className="h-5 w-5" aria-hidden="true" /></span>
              <p className="brand-eyebrow mt-6">{isGuided ? 'Small-class course' : 'Self-paced course'}</p>
              <h2 className="mt-2 font-display text-3xl font-medium leading-tight">{slug ? 'What’s included' : offering.name}</h2>
              {offering.image_url && <img src={offering.image_url} alt="" className="mt-4 aspect-video w-full rounded-xl object-cover" />}
              <p className="mt-2 text-sm text-ink-secondary">{offering.description}</p>
              {offering.checkout_available && offering.price_cents && <p className="mt-3 text-2xl font-extrabold">${(offering.price_cents / 100).toFixed(2)} <span className="text-sm font-semibold text-ink-muted">USD one-time</span></p>}
              {hasSeatCap && (
                <p className={`mt-3 inline-flex items-center gap-2 self-start rounded-md px-3 py-1.5 text-sm font-semibold ${soldOut ? 'border border-danger-line bg-danger-soft text-danger-ink' : 'border border-brand-line bg-brand-cream text-ink'}`}>
                  <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {soldOut
                    ? `Class full · 0 of ${offering.seat_limit} seats remaining`
                    : `${offering.seats_remaining ?? 0} of ${offering.seat_limit} ${offering.seats_remaining === 1 ? 'seat' : 'seats'} remaining`}
                </p>
              )}
              <div className="mt-7 space-y-3 text-sm text-ink-secondary">
                {isGuided && offering.start_date && (
                  <p className="flex items-start gap-3">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
                    Starts {formatShortDate(offering.start_date, offering.start_date)}
                  </p>
                )}
                <p className="flex items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />{accessLine}</p>
                <p className="flex items-start gap-3"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />{supportLine}</p>
              </div>
              <p className="mt-6 text-sm text-ink-secondary">Your instructor will review your work — {reviewTiming(offering.instructor_response_target)}.</p>
              <p className="mt-3 text-sm text-ink-secondary">{offering.lesson_count} lessons{offering.duration ? ` · ${offering.duration}` : ''}</p>

              <div className="mt-auto pt-7">
                {!slug && offeringSlug && (
                  <div className="mb-3">
                    <LinkButton to={`/courses/${offeringSlug}`} variant="secondary" shape="brand" size="lg">View course</LinkButton>
                  </div>
                )}
                {user?.is_staff ? <p className="text-sm text-ink-secondary">Staff preview — students see the enrollment button here.</p>
                  : enrolled ? <LinkButton to={`/dashboard?cohort_id=${offering.id}`} size="lg" shape="brand">Open course <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
                  : returning ? null
                  : pendingPurchase && isCanceled ? <CourseCheckoutStatus purchaseId={String(pendingPurchase.id)} canceled slug={validatedSlug ?? offeringSlug ?? undefined} offeringId={offering.id} onRequireCommunityStandards={requireCommunityStandardsForCheckout} />
                  : pendingPurchase ? <LinkButton to={`${returnCoursePath}?checkout=return&purchase_id=${pendingPurchase.id}&offering_id=${offering.id}`} variant="secondary">Check enrollment confirmation</LinkButton>
                  : isSignedIn && (!pending || purchaseError) ? (
                    <div role="status" className="space-y-3 text-sm text-ink-secondary">
                      <p>
                        {purchaseError ? (
                          <>
                            We couldn’t check your purchases. Try again or{' '}
                            <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent('Checkout status help')}`}>
                              contact {brand.schoolAbbreviation}
                            </a>{' '}
                            before trying checkout.
                          </>
                        ) : 'Checking your purchases…'}
                      </p>
                      {purchaseError && <Button variant="secondary" shape="brand" onClick={() => setPurchaseReloadKey((key) => key + 1)}>Try again</Button>}
                    </div>
                  )
                  : !offering.checkout_available ? <span className="inline-flex min-h-12 items-center text-sm font-bold text-ink-muted">Enrollment is not open yet</span>
                  : soldOut ? (
                    <div>
                      <Button size="lg" shape="brand" disabled>Class full</Button>
                      <p className="mt-3 text-sm leading-6 text-ink-secondary">
                        This class is full. Email{' '}
                        <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${brand.supportEmail}`}>
                          {brand.supportEmail}
                        </a>{' '}
                        to join the waitlist or ask about the next session.
                      </p>
                    </div>
                  )
                  : !isSignedIn || !user ? (
                    <div className="space-y-2">
                      <LinkButton to={signUpPath} size="lg" shape="brand">Create an account to enroll <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
                      <p className="text-sm text-ink-secondary">
                        Already have an account?{' '}
                        <Link to={cardSignInPath} className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink">
                          Sign in
                        </Link>
                      </p>
                    </div>
                  )
                  : <Button size="lg" shape="brand" disabled={checkingOut !== null} onClick={() => void startCheckout(offering.id)}>{checkingOut === offering.id ? 'Opening checkout…' : 'Continue to secure checkout'} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>}
              </div>
              {slug && <div className="mt-7 space-y-7">
                {([['What you’ll learn', offering.outcomes], ['Before you start', offering.prerequisites], ['Course preview', offering.preview]] as const).map(([title, text]) => text && <section key={title}><h3 className="text-lg font-bold">{title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-secondary">{text}</p></section>)}
                <section><h3 className="text-lg font-bold">Syllabus</h3><p className="mt-1 text-sm text-ink-muted">Published lessons in this course.</p><ol className="mt-4 space-y-5">{offering.syllabus.map((section, index) => <li key={index}><h4 className="font-semibold">Section {index + 1}</h4><ul className="mt-2 list-inside list-disc space-y-2 text-sm text-ink-secondary">{section.lessons.map((title, i) => <li key={i}>{title}</li>)}</ul></li>)}</ol></section>
              </div>}
            </article>
          })}
          {!loading && offerings.length === 0 && !(returning && notFound) && <div className="rounded-md border border-brand-line bg-surface-raised p-8 md:col-span-2">
            <h2 className="font-display text-2xl font-medium">{error ? 'Course listings are unavailable' : 'Courses are being prepared'}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{error || 'We are recording and testing the first focused course. Enrollment will appear here when it opens.'}</p>
            <a href={SCHOOL_COURSES_URL} className="mt-4 inline-flex min-h-11 items-center font-bold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink">Explore courses at {new URL(SCHOOL_COURSES_URL).host}</a>
            {error && <Button variant="secondary" shape="brand" className="mt-5" onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }}>Try again</Button>}
          </div>}
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}

import { reviewTiming } from '../lib/reviewCopy'
import { usePublicCatalogAvailability } from '../lib/usePublicCatalogAvailability'
import { pageTitle } from '../lib/glossary'
import { brand } from '../lib/brand'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpenText, Clock3, MessageCircle, Users } from 'lucide-react'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { Button, LinkButton } from '../components/ui/Button'
import { api } from '../lib/api'
import { useAuthContext } from '../contexts/AuthContext'
import { CourseCheckoutStatus } from '../components/courses/CourseCheckoutStatus'
import { courseAuthPath, offeringIdFrom } from '../lib/courseIntent'
import { SCHOOL_COURSES_URL } from '../lib/brand'
import { hasCourseAccess } from '../lib/courseAccess'
import { formatShortDate } from '../lib/format'

type Offering = NonNullable<Awaited<ReturnType<typeof api.getCourseOfferings>>['data']>['offerings'][number]

function CourseUnavailable() {
  const catalogAvailable = usePublicCatalogAvailability()
  return <div className="flex min-h-svh flex-col bg-brand-cream text-ink"><PublicHeader /><main className="safe-px mx-auto w-full max-w-[1200px] flex-1 py-16"><h1 className="font-display text-4xl">This course isn’t available</h1><p className="mt-5 max-w-xl text-ink-secondary">It may no longer be open for enrollment. Your existing learning is still available when you sign in.</p><LinkButton className="mt-6" to={catalogAvailable ? '/courses' : '/sign-in'}>{catalogAvailable ? 'Browse courses' : 'Sign in'}</LinkButton></main><PublicFooter /></div>
}

export function CourseCatalog() {
  const { isSignedIn, user, enrollments } = useAuthContext()
  const [searchParams] = useSearchParams()
  const { slug } = useParams()
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [pending, setPending] = useState<Array<{ id: number; cohort_id: number }> | null>(null)
  const [purchaseError, setPurchaseError] = useState(false)
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
    api.getPendingCoursePurchases().then((result) => {
      if (!active) return
      if (result.data && !result.error) setPending(result.data.purchases)
      else setPurchaseError(true)
    }).catch(() => { if (active) setPurchaseError(true) })
    return () => { active = false }
  }, [isSignedIn, user?.id, user?.is_staff])

  useEffect(() => {
    if (slug && !loading) document.title = pageTitle(notFound ? 'Course unavailable' : offerings[0]?.name || 'Course')
  }, [slug, loading, notFound, offerings])

  const startCheckout = async (cohortId: number) => {
    setCheckingOut(cohortId)
    setError(null)
    try {
      const result = await api.startCourseCheckout(cohortId)
      if (result.data?.url) {
        window.location.assign(result.data.url)
        return
      }
      setError(result.error || 'Checkout could not start. Please try again.')
      if (result.status === 409) setReloadKey((key) => key + 1)
    } finally {
      setCheckingOut(null)
    }
  }

  if (slug && notFound) return <CourseUnavailable />

  const signInParams = new URLSearchParams(searchParams)
  if (slug && offerings[0]) {
    signInParams.set('offering_id', String(offerings[0].id))
    if (offerings[0].unlisted && offerings[0].slug) signInParams.set('offering_slug', offerings[0].slug)
  }
  const signInPath = slug && offerings[0] ? `/sign-in?${signInParams}` : courseAuthPath('/sign-in', searchParams.toString())

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      <PublicHeader actions={<LinkButton to={isSignedIn ? '/dashboard' : signInPath} variant="quiet" shape="brand" className="px-3 text-ink">{isSignedIn ? 'My learning' : 'Sign in'}</LinkButton>} />
      <main className="safe-px mx-auto w-full max-w-[1200px] flex-1 py-12 lg:py-20">
        <p className="brand-eyebrow">Focused courses</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-medium leading-tight tracking-[-0.03em] sm:text-6xl">{slug ? offerings[0]?.name || 'Course' : 'Learn one useful skill at a time.'}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-ink-secondary">Study on your schedule, practice what you learn, and get feedback from a real instructor.</p>
        {((slug && !offerings[0]?.unlisted) || selectedId) && <LinkButton to="/courses" variant="quiet" className="mt-4">Back to courses</LinkButton>}
        {returning && <CourseCheckoutStatus purchaseId={searchParams.get('purchase_id') || ''} />}
        {!returning && selectedId && !loading && !offerings.some((offering) => offering.id === selectedId) && <p role="status" className="mt-8">This course is not currently listed. Contact {brand.schoolAbbreviation} if you need help enrolling.</p>}
        {searchParams.get('checkout') === 'canceled' && <p role="status" className="mt-8 rounded-xl border border-line bg-surface-raised p-4 text-sm text-ink-secondary">Checkout not completed. Review your course below to continue checkout.</p>}
        {error && offerings.length > 0 && <p role="alert" className="mt-8 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-ink">{error}</p>}
        <div className={`mt-12 grid gap-6 ${slug ? "max-w-4xl" : "md:grid-cols-2"}`}>
          {loading && offerings.length === 0 && <p role="status" className="text-sm text-ink-secondary md:col-span-2">Loading courses…</p>}
          {offerings.filter((offering) => !selectedId || !offerings.some((entry) => entry.id === selectedId) || offering.id === selectedId).map((offering) => {
            const enrolled = enrollments.some((entry) => entry.cohort.id === offering.id && hasCourseAccess(entry))
            const pendingPurchase = pending?.find((purchase) => purchase.cohort_id === offering.id)
            const isGuided = offering.course_delivery === 'guided'
            const hasSeatCap = offering.seat_limit != null
            const soldOut = Boolean(offering.sold_out)
            const signUpPath = offering.unlisted && offering.slug
              ? `/sign-up?offering_id=${offering.id}&offering_slug=${encodeURIComponent(offering.slug)}`
              : `/sign-up?offering_id=${offering.id}`
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
                  : 'Ask an instructor for help during the cohort'
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
                    ? `Cohort full · 0 of ${offering.seat_limit} seats remaining`
                    : `${offering.seats_remaining ?? 0} of ${offering.seat_limit} ${offering.seats_remaining === 1 ? 'seat' : 'seats'} remaining`}
                </p>
              )}
              <div className="mt-7 space-y-3 text-sm text-ink-secondary">
                <p className="flex items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />{accessLine}</p>
                <p className="flex items-start gap-3"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />{supportLine}</p>
              </div>
              <p className="mt-6 text-sm text-ink-secondary">Your instructor will review your work — {reviewTiming(offering.instructor_response_target)}.</p>
              <p className="mt-3 text-sm text-ink-secondary">{offering.lesson_count} lessons{offering.duration ? ` · ${offering.duration}` : ''}</p>

              <div className="mt-auto pt-7">
                {user?.is_staff ? <p className="text-sm text-ink-secondary">Staff preview — students see the enrollment button here.</p>
                  : enrolled ? <LinkButton to={`/dashboard?cohort_id=${offering.id}`} size="lg" shape="brand">Open course <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
                  : returning ? null
                  : pendingPurchase && searchParams.get('checkout') === 'canceled' ? <CourseCheckoutStatus purchaseId={String(pendingPurchase.id)} canceled />
                  : pendingPurchase ? <LinkButton to={`${offering.unlisted && offering.slug ? `/courses/${offering.slug}` : '/courses'}?checkout=return&purchase_id=${pendingPurchase.id}&offering_id=${offering.id}`} variant="secondary">Check enrollment confirmation</LinkButton>
                  : isSignedIn && (!pending || purchaseError) ? <p role="status" className="text-sm text-ink-secondary">{purchaseError ? `We could not check your purchases. Refresh or contact ${brand.schoolAbbreviation} before trying checkout.` : 'Checking your purchases…'}</p>
                  : !offering.checkout_available ? <span className="inline-flex min-h-12 items-center text-sm font-bold text-ink-muted">Enrollment is not open yet</span>
                  : soldOut ? (
                    <div>
                      <Button size="lg" shape="brand" disabled>Cohort full</Button>
                      <p className="mt-3 text-sm leading-6 text-ink-secondary">
                        This cohort is full. Email{' '}
                        <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${brand.supportEmail}`}>
                          {brand.supportEmail}
                        </a>{' '}
                        to join the waitlist or ask about the next session.
                      </p>
                    </div>
                  )
                  : !isSignedIn || !user ? <LinkButton to={signUpPath} size="lg" shape="brand">Create an account to enroll <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
                  : <Button size="lg" shape="brand" disabled={checkingOut !== null} onClick={() => void startCheckout(offering.id)}>{checkingOut === offering.id ? 'Opening checkout…' : 'Continue to secure checkout'} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>}
              </div>
              {slug ? <div className="mt-7 space-y-7">
                {([['What you’ll learn', offering.outcomes], ['Before you start', offering.prerequisites], ['Course preview', offering.preview]] as const).map(([title, text]) => text && <section key={title}><h3 className="text-lg font-bold">{title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-secondary">{text}</p></section>)}
                <section><h3 className="text-lg font-bold">Syllabus</h3><p className="mt-1 text-sm text-ink-muted">Published lessons in this course.</p><ol className="mt-4 space-y-5">{offering.syllabus.map((section, index) => <li key={index}><h4 className="font-semibold">Section {index + 1}</h4><ul className="mt-2 list-inside list-disc space-y-2 text-sm text-ink-secondary">{section.lessons.map((title, i) => <li key={i}>{title}</li>)}</ul></li>)}</ol></section>
              </div> : offering.slug && <LinkButton to={`/courses/${offering.slug}`} variant="secondary" className="mt-5 self-start">View course</LinkButton>}
            </article>
          })}
          {!loading && offerings.length === 0 && <div className="rounded-md border border-brand-line bg-surface-raised p-8 md:col-span-2">
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

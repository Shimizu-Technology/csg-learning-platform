import { brand } from '../lib/brand'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type PublicCourse } from '../lib/api'
import { useAuthContext } from '../contexts/AuthContext'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { LinkButton, AnchorButton } from '../components/ui/Button'
import { PRODUCT_NAME, SCHOOL_COURSES_URL, SCHOOL_NAME } from '../lib/brand'

const gettingStarted = [
  {
    title: 'Open your invitation email',
    body: `Choose “Accept invitation” in the email from ${SCHOOL_NAME}. It opens ${PRODUCT_NAME} with your invitation attached.`,
  },
  {
    title: 'Create your account',
    body: 'Your invited email is already filled in. Choose a password, or continue with Google if it uses that same address.',
  },
  {
    title: 'Start your first lesson',
    body: 'Agree to the community guidelines once, then your course, messages, and meetings are waiting.',
  },
]

/** A course-neutral explanation; available courses below come only from the API. */
function LearningOverview() {
  return <aside className="rounded-2xl border border-brand-line bg-surface-raised p-6 sm:p-8" aria-label="How learning works">
    <p className="brand-eyebrow">Learn by doing</p>
    <ol className="mt-6 divide-y divide-line">{[
      ['Learn a useful skill', 'Follow clear lessons on your phone or computer.'],
      ['Put it into practice', 'Try exercises and build work you can explain.'],
      ['Get instructor feedback', 'Submit your work, ask for help, and improve it.'],
    ].map(([title, body], i) => <li key={title} className="flex gap-4 py-5"><span className="text-lg font-bold tabular-nums text-primary-ink">0{i + 1}</span><div><h2 className="font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{body}</p></div></li>)}</ol>
  </aside>
}

export function HomePage() {
  const { isSignedIn, user } = useAuthContext()
  const request = useRef<ReturnType<typeof api.getCourseOfferings> | null>(null)
  const [courses, setCourses] = useState<PublicCourse[]>([])
  useEffect(() => {
    let active = true
    request.current ??= api.getCourseOfferings()
    request.current.then(r => {
      if (active && !r.error && r.data) setCourses(r.data.public_catalog_mode === 'hidden' ? [] : r.data.offerings.filter(course => course.checkout_available))
    }).catch(() => { /* The invitation and catalog paths remain available. */ })
    return () => { active = false }
  }, [])
  const catalogAvailable = courses.length > 0
  const dashboardPath = user?.is_staff ? '/admin' : '/dashboard'

  const headerActions = isSignedIn ? (
    <LinkButton to={dashboardPath} shape="brand">
      Open {PRODUCT_NAME}
    </LinkButton>
  ) : (
    <>
      <LinkButton to="/sign-in" variant="quiet" shape="brand" className="px-3 text-ink">
        Sign in
      </LinkButton>
      {/* Wrapped so `hidden` is not overridden by the button's own display class. */}
      <span className="hidden sm:block">
        <LinkButton to="/sign-up" variant="secondary" shape="brand">
          I have an invitation
        </LinkButton>
      </span>
    </>
  )

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-3 focus:font-bold">
        Skip to content
      </a>
      <PublicHeader actions={headerActions} />

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <section className="border-b border-brand-line">
          <div className="safe-px mx-auto grid max-w-[1200px] gap-10 py-12 md:py-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:py-20">
            <div>
              <p className="brand-eyebrow">Practical learning, personal support</p>
              <h1 className="mt-5 max-w-xl font-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-ink sm:text-6xl">
                Build a skill. Put it to work.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-ink-secondary">
                {SCHOOL_NAME} brings lessons, hands-on practice, and instructor feedback together in {PRODUCT_NAME}. Browse a course or sign in to continue learning.
              </p>

              {isSignedIn ? (
                <div className="mt-8">
                  <LinkButton to={dashboardPath} size="lg" shape="brand">
                    {user?.is_staff ? 'Open Today' : 'Continue learning'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </LinkButton>
                </div>
              ) : (
                <>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <LinkButton to="/courses" size="lg" shape="brand">
                      Browse courses <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </LinkButton>
                    <LinkButton to="/sign-up" size="lg" variant="secondary" shape="brand">
                      I have an invitation
                    </LinkButton>
                  </div>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-ink-secondary">
                    New here? Open your invitation email and choose “Accept invitation” to create your account.
                  </p>
                </>
              )}

              <div className="mt-8 grid grid-cols-1 gap-1 border-t border-brand-line pt-5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
                <span className="font-semibold text-ink">Not enrolled yet?</span>
                <a href={SCHOOL_COURSES_URL} className="inline-flex min-h-11 items-center gap-1 font-bold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink sm:min-h-0">
                  Explore courses at {new URL(SCHOOL_COURSES_URL).host} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
                {catalogAvailable && <div className="sm:col-start-2">
                  <Link to="/courses" className="inline-flex min-h-11 items-center gap-1 font-bold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink">
                    See the course catalog
                  </Link>
                </div>}
              </div>
            </div>

            <LearningOverview />
          </div>
        </section>

        {courses.length > 0 && <section className="safe-px mx-auto max-w-[1200px] py-14" aria-labelledby="available-courses-title">
          <p className="brand-eyebrow">Open for enrollment</p><h2 id="available-courses-title" className="mt-4 font-display text-4xl">Choose your next skill.</h2>
          <div className="mt-7 grid gap-5 md:grid-cols-2">{courses.map(course => <article key={course.id} className="rounded-2xl border border-line bg-surface-raised p-6">
            {course.image_url && <img className="mb-5 aspect-video w-full rounded-xl object-cover" src={course.image_url} alt="" loading="lazy" />}
            <h3 className="text-xl font-bold">{course.name}</h3><p className="mt-3 text-sm leading-7 text-ink-secondary">{course.description}</p>
            <LinkButton to={course.slug ? `/courses/${course.slug}` : `/courses?offering_id=${course.id}`} className="mt-5" variant="secondary">View course <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
          </article>)}</div>
        </section>}

        {!isSignedIn && (
          <section className="py-14 md:py-20" aria-labelledby="getting-started-title">
            <div className="safe-px mx-auto grid max-w-[1200px] gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
              <div>
                <p className="brand-eyebrow">Invited learners</p>
                <h2 id="getting-started-title" className="mt-4 font-display text-4xl font-medium leading-tight tracking-[-0.02em] md:text-5xl">
                  Getting started takes a few minutes.
                </h2>
              </div>
              <ol className="divide-y divide-brand-line border-y border-brand-line">
                {gettingStarted.map((step, index) => (
                  <li key={step.title} className="grid gap-2 py-6 sm:grid-cols-[48px_1fr] sm:gap-6">
                    <span className="font-display text-2xl font-medium tabular-nums text-primary-ink">{index + 1}</span>
                    <div>
                      <h3 className="text-lg font-bold text-ink">{step.title}</h3>
                      <p className="mt-1 text-base leading-7 text-ink-secondary">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="safe-px mx-auto mt-10 flex max-w-[1200px] flex-col gap-3 sm:flex-row">
              <LinkButton to="/sign-up" size="lg" shape="brand">
                Accept my invitation <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </LinkButton>
              <AnchorButton href={`mailto:${brand.supportEmail}`} size="lg" shape="brand">
                Can't find your invitation? Email us
              </AnchorButton>
            </div>
          </section>
        )}
      </main>

      <PublicFooter />
    </div>
  )
}

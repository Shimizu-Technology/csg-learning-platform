import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, CalendarClock, Check, MessageCircle, PlayCircle } from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { LinkButton, AnchorButton } from '../components/ui/Button'
import { PRODUCT_NAME, SCHOOL_COURSES_URL, SCHOOL_NAME } from '../lib/brand'

const gettingStarted = [
  {
    title: 'Open your invitation',
    body: `Use the link in the email from ${SCHOOL_NAME}, or choose “I have an invitation” here.`,
  },
  {
    title: 'Create your account',
    body: 'Sign up with the same email address the invitation was sent to. Google sign-in works if it uses that address.',
  },
  {
    title: 'Start your first lesson',
    body: 'Agree to the community guidelines once, then your course, messages, and meetings are waiting.',
  },
]

/** Honest, course-agnostic product illustration (sample content, labelled as such). */
function IllustrativeCourseView() {
  const steps = [
    { label: 'Orientation', status: 'Done', state: 'done' },
    { label: 'Variables and decisions', status: 'In progress', state: 'current' },
    { label: 'Week 1 checkpoint', status: 'Up next', state: 'next' },
  ] as const

  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-md border border-brand-line bg-surface-raised" aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-line px-5 py-4">
          <p className="text-sm font-bold text-ink">Python Fundamentals</p>
          <span className="rounded-full bg-brand-cream-sunken px-3 py-1 text-xs font-semibold text-ink-secondary">Week 1</span>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="rounded-md border border-line bg-surface-page p-4">
            <p className="text-xs font-semibold text-ink-secondary">Next step</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-base font-bold text-ink">Make a program decide</p>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-action-primary text-on-action">
                <ArrowRight className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-[62%] rounded-full bg-action-primary" />
            </div>
          </div>
          <ol className="space-y-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    step.state === 'done'
                      ? 'bg-success-50 text-success-700'
                      : step.state === 'current'
                        ? 'border-2 border-action-primary bg-surface-raised'
                        : 'border-2 border-line-strong bg-surface-raised'
                  }`}
                >
                  {step.state === 'done' && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{step.label}</span>
                <span className="shrink-0 text-xs text-ink-secondary">{step.status}</span>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
            {[
              [MessageCircle, 'Ask your instructor'],
              [CalendarClock, 'Book a meeting'],
              [PlayCircle, 'Watch recordings'],
            ].map(([Icon, label]) => {
              const ItemIcon = Icon as typeof MessageCircle
              return (
                <span key={label as string} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink-secondary">
                  <ItemIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                  {label as string}
                </span>
              )
            })}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-ink-secondary">
        Illustration with sample course content. What you see depends on your course.
      </figcaption>
    </figure>
  )
}

export function HomePage() {
  const { isSignedIn, user } = useAuthContext()
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
              <p className="brand-eyebrow">Your learning workspace</p>
              <h1 className="mt-5 max-w-xl font-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-ink sm:text-6xl">
                Your course, your questions, and your progress in one place.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-ink-secondary">
                {PRODUCT_NAME} is where enrolled {SCHOOL_NAME} learners open lessons, submit code, get feedback, and message their instructor, on a phone or a computer.
              </p>

              {isSignedIn ? (
                <div className="mt-8">
                  <LinkButton to={dashboardPath} size="lg" shape="brand">
                    Continue learning <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </LinkButton>
                </div>
              ) : (
                <>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <LinkButton to="/sign-in" size="lg" shape="brand">
                      Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </LinkButton>
                    <LinkButton to="/sign-up" size="lg" variant="secondary" shape="brand">
                      I have an invitation
                    </LinkButton>
                  </div>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-ink-secondary">
                    New here with an invitation? Create your account with the email address the invitation was sent to.
                  </p>
                </>
              )}

              <div className="mt-8 flex flex-col gap-1 border-t border-brand-line pt-5 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
                <span className="font-semibold text-ink">Not enrolled yet?</span>
                <a href={SCHOOL_COURSES_URL} className="inline-flex min-h-11 items-center gap-1 font-bold text-ruby-700 underline underline-offset-4 hover:text-ruby-800 sm:min-h-0">
                  Explore courses at codeschoolofguam.com <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <Link to="/courses" className="inline-flex min-h-11 items-center gap-1 font-bold text-ruby-700 underline underline-offset-4 hover:text-ruby-800 sm:min-h-0">
                  See the course catalog
                </Link>
              </div>
            </div>

            <IllustrativeCourseView />
          </div>
        </section>

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
                    <span className="font-display text-2xl font-medium tabular-nums text-ruby-700">{index + 1}</span>
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
              <AnchorButton href="mailto:codeschoolofguam@gmail.com" size="lg" shape="brand">
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

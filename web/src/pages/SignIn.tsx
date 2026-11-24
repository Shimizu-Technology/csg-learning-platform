import { brand } from '../lib/brand'
import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react'
import { signUpModeFrom } from '../lib/clerkSignUpMode'
import { InvitationHelp } from '../components/auth/InvitationHelp'
import { clerkAuthAppearanceFor, setClerkAuthMode } from '../lib/clerkAppearance'
import { useTheme } from '../lib/theme'
import { useAuthContext } from '../contexts/AuthContext'
import { Navigate, useLocation } from 'react-router-dom'
import { BookOpenText, Loader2, LogOut, Mail, MessageCircle, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { AuthWidgetStatus } from '../components/auth/AuthWidgetStatus'
import { AnchorButton, Button, LinkButton } from '../components/ui/Button'
import { courseAuthPath, courseIntentDestination, offeringIdFrom } from '../lib/courseIntent'
import { hasInvitationTicket, PRODUCT_NAME, SCHOOL_NAME } from '../lib/brand'

const SUPPORT_EMAIL = `${brand.supportEmail}`

function AuthShell({
  eyebrow,
  title,
  description,
  switchLink,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  switchLink?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      {/* The switch link repeats Clerk's footer link; below 360px the brand name needs the room. */}
      <PublicHeader actions={switchLink && <span className="hidden min-[360px]:block">{switchLink}</span>} />
      <main className="safe-px mx-auto grid w-full max-w-[1200px] flex-1 gap-8 py-8 sm:py-12 lg:grid-cols-[1fr_minmax(0,440px)] lg:items-center lg:gap-16 lg:py-16">
        <div className="max-w-xl">
          <p className="brand-eyebrow">{eyebrow}</p>
          <h1 className="mt-4 font-display text-4xl font-medium leading-[1.08] tracking-[-0.03em] sm:text-5xl">{title}</h1>
          <p className="mt-4 text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">{description}</p>
          <ul className="mt-8 hidden space-y-4 lg:block">
            {[
              [BookOpenText, 'Pick up at the exact lesson you need'],
              [MessageCircle, 'Ask your instructor about your code'],
              [PlayCircle, 'Resume recordings where you stopped'],
            ].map(([Icon, label]) => {
              const ItemIcon = Icon as typeof BookOpenText
              return (
                <li key={label as string} className="flex items-center gap-3 text-base text-ink-secondary">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-line bg-surface-raised"><ItemIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" /></span>
                  {label as string}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="w-full min-w-0">
          {children}
          <p className="mt-5 text-center text-sm leading-6 text-ink-secondary">
            Trouble signing in? Email{' '}
            <a className="font-semibold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn, accessDenied } = useAuthContext()
  const { search } = useLocation()

  if (isSignedIn && !accessDenied) {
    return <Navigate to={courseIntentDestination(search)} replace />
  }

  return children
}

function AccessDeniedCard() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const { sessionError, sessionErrorCode, syncSession } = useAuthContext()
  const [signingOut, setSigningOut] = useState(false)
  const [checking, setChecking] = useState(false)
  const email = user?.primaryEmailAddress?.emailAddress

  const heading = sessionErrorCode === 'identity_unverified'
    ? 'We couldn’t verify your email'
    : sessionErrorCode === 'identity_conflict'
      ? 'We couldn’t match this sign-in to your account'
      : sessionErrorCode === 'account_archived'
        ? 'This account is inactive'
        : 'This account isn’t on the class list'

  const guidance = sessionErrorCode === 'identity_unverified'
    ? 'Verify your email address or try signing in with Google, or contact support for help.'
    : sessionErrorCode === 'identity_conflict'
      ? `Sign out to try another account, or email ${SCHOOL_NAME} support so we can link your account safely.`
      : sessionErrorCode === 'account_archived'
        ? `Sign out to use another account, or email ${SCHOOL_NAME} support if you think this is a mistake.`
        : `If an administrator just invited this address, check again. Otherwise, use the exact email from your ${SCHOOL_NAME} invitation.`

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut({ redirectUrl: '/sign-in' })
    } finally {
      setSigningOut(false)
    }
  }

  const handleCheckAccess = async () => {
    setChecking(true)
    try {
      await syncSession()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-brand-line bg-surface-raised">
      <div className="border-b border-brand-line px-6 py-7 sm:px-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-warning-soft text-warning-ink">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink">{heading}</h2>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">
          {sessionError || `${PRODUCT_NAME} is invite-only. Ask a ${SCHOOL_NAME} administrator to add the email you use to sign in.`}
        </p>
      </div>
      <div className="space-y-4 px-6 py-6 sm:px-8">
        {email && (
          <div className="rounded-md border border-brand-line bg-brand-cream px-4 py-3">
            <p className="text-xs font-semibold text-ink-secondary">Signed in as</p>
            <p className="mt-1 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{email}</p>
          </div>
        )}
        <p className="text-sm leading-6 text-ink-secondary">{guidance}</p>
        <Button size="lg" shape="brand" fullWidth onClick={() => void handleCheckAccess()} disabled={checking || signingOut}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {checking ? 'Checking access…' : sessionErrorCode === 'account_not_authorized' || !sessionErrorCode ? 'I’ve been invited — check again' : 'Check again'}
        </Button>
        <Button size="lg" shape="brand" variant="secondary" fullWidth onClick={() => void handleSignOut()} disabled={checking || signingOut}>
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          {signingOut ? 'Signing out…' : 'Use a different account'}
        </Button>
        <AnchorButton
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${PRODUCT_NAME} account access help`)}`}
          size="lg"
          shape="brand"
          variant="quiet"
          fullWidth
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          Contact support
        </AnchorButton>
      </div>
    </div>
  )
}

function CourseSignUpUnavailable({ signInUrl }: { signInUrl: string }) {
  const subject = encodeURIComponent(`${PRODUCT_NAME} course enrollment help`)
  return (
    <section aria-labelledby="course-signup-unavailable-title" className="rounded-md border border-brand-line bg-surface-raised p-6 sm:p-8">
      <h2 id="course-signup-unavailable-title" className="font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink">
        Self-serve sign-ups aren’t open right now
      </h2>
      <p className="mt-3 text-base leading-7 text-ink-secondary">
        If you already have a {PRODUCT_NAME} account, sign in to continue with your course. Otherwise, email {SCHOOL_NAME} and we’ll help you get enrolled.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <LinkButton to={signInUrl} size="lg" shape="brand" fullWidth>
          Sign in to continue
        </LinkButton>
        <AnchorButton href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`} variant="secondary" size="lg" shape="brand" fullWidth>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Contact support
        </AnchorButton>
      </div>
    </section>
  )
}

const deniedCopy = {
  eyebrow: 'Account access',
  title: 'Let’s get you into class.',
  description: `Only invited ${SCHOOL_NAME} learners and staff can use ${PRODUCT_NAME}.`,
}

/** Clerk takes colour strings, so the widget follows the theme by re-rendering with that theme's palette. */
function useAuthAppearance() {
  const { theme } = useTheme()
  return useMemo(() => clerkAuthAppearanceFor(theme), [theme])
}

export function SignInPage() {
  const authAppearance = useAuthAppearance()
  const { search } = useLocation()
  const courseIntent = offeringIdFrom(search) !== null
  const { accessDenied } = useAuthContext()

  useEffect(() => {
    setClerkAuthMode(courseIntent ? 'course' : 'invite')
    return () => setClerkAuthMode('invite')
  }, [courseIntent])

  if (accessDenied) {
    return (
      <AuthShell {...deniedCopy}>
        <AccessDeniedCard />
      </AuthShell>
    )
  }

  return (
    <RedirectIfSignedIn>
      <AuthShell
        eyebrow="Welcome back"
        title="Sign in and pick up where you left off."
        description={courseIntent ? 'Sign in to continue with your selected course.' : `Use the email address for your ${SCHOOL_NAME} account.`}
        switchLink={<LinkButton to={courseAuthPath('/sign-up', search)} variant="quiet" shape="brand" className="px-3 text-ink">{courseIntent ? 'Create an account' : 'I have an invitation'}</LinkButton>}
      >
        <AuthWidgetStatus />
        <SignIn
          appearance={authAppearance}
          routing="hash"
          signUpForceRedirectUrl={courseIntentDestination(search, '') || undefined}
          signUpUrl={courseAuthPath('/sign-up', search)}
          fallbackRedirectUrl={courseIntentDestination(search)}
          forceRedirectUrl={courseIntentDestination(search, '') || undefined}
        />
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

export function SignUpPage() {
  const authAppearance = useAuthAppearance()
  const { accessDenied } = useAuthContext()
  const location = useLocation()
  const search = location.search
  const clerk = useClerk()
  const fromInvitation = hasInvitationTicket(location.search)
  const hasOffering = offeringIdFrom(search) !== null
  // Production Clerk is invitation-only: without a ticket, guide the learner to their email link.
  const needsInvitationLink = !fromInvitation && clerk.loaded && signUpModeFrom(clerk) === 'restricted'

  useEffect(() => {
    setClerkAuthMode(hasOffering ? 'course' : 'invite')
    return () => setClerkAuthMode('invite')
  }, [hasOffering])

  if (accessDenied) {
    return (
      <AuthShell {...deniedCopy}>
        <AccessDeniedCard />
      </AuthShell>
    )
  }

  const signInUrl = courseAuthPath('/sign-in', search)

  return (
    <RedirectIfSignedIn>
      <AuthShell
        eyebrow={fromInvitation ? 'Your invitation' : hasOffering ? 'Your selected course' : 'Have an invitation?'}
        title={fromInvitation ? 'Accept your invitation.' : 'Create your account.'}
        description={fromInvitation
          ? 'Your invited email is already filled in. Finish creating your account and your course will be waiting.'
          : hasOffering ? 'Create an account to continue with your selected course. You can review it before checkout.'
          : `Your account starts from the invitation ${SCHOOL_NAME} emailed you. If you already have an account, sign in instead.`}
        switchLink={<LinkButton to={signInUrl} variant="quiet" shape="brand" className="px-3 text-ink">Sign in</LinkButton>}
      >
        <AuthWidgetStatus />
        {needsInvitationLink ? (
          hasOffering ? <CourseSignUpUnavailable signInUrl={signInUrl} /> : <InvitationHelp />
        ) : (
          <SignUp
            appearance={authAppearance}
            routing="hash"
            signInForceRedirectUrl={courseIntentDestination(search, '') || undefined}
            signInUrl={signInUrl}
            fallbackRedirectUrl={courseIntentDestination(search)}
            forceRedirectUrl={courseIntentDestination(search, '') || undefined}
          />
        )}
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react'
import { clerkAuthAppearance } from '../lib/clerkAppearance'
import { useAuthContext } from '../contexts/AuthContext'
import { Navigate, useLocation } from 'react-router-dom'
import { BookOpenText, Loader2, LogOut, MessageCircle, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { PublicFooter, PublicHeader } from '../components/brand/PublicChrome'
import { AuthWidgetStatus } from '../components/auth/AuthWidgetStatus'
import { Button, LinkButton } from '../components/ui/Button'
import { hasInvitationTicket, PRODUCT_NAME, SCHOOL_NAME } from '../lib/brand'

const SUPPORT_EMAIL = 'codeschoolofguam@gmail.com'

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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-line bg-surface-raised"><ItemIcon className="h-4 w-4 text-ruby-700" aria-hidden="true" /></span>
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
            <a className="font-semibold text-ruby-700 underline underline-offset-4 hover:text-ruby-800" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn, accessDenied } = useAuthContext()

  if (isSignedIn && !accessDenied) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function AccessDeniedCard() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const { sessionError, syncSession } = useAuthContext()
  const [signingOut, setSigningOut] = useState(false)
  const [checking, setChecking] = useState(false)
  const email = user?.primaryEmailAddress?.emailAddress

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
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-warning-50 text-warning-800">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink">This account isn’t on the class list</h2>
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
        <p className="text-sm leading-6 text-ink-secondary">
          If an administrator just invited this address, check again. Otherwise, use the exact email from your {SCHOOL_NAME} invitation.
        </p>
        <Button size="lg" shape="brand" fullWidth onClick={() => void handleCheckAccess()} disabled={checking || signingOut}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {checking ? 'Checking access…' : 'I’ve been invited — check again'}
        </Button>
        <Button size="lg" shape="brand" variant="secondary" fullWidth onClick={() => void handleSignOut()} disabled={checking || signingOut}>
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          {signingOut ? 'Signing out…' : 'Use a different account'}
        </Button>
      </div>
    </div>
  )
}

const deniedCopy = {
  eyebrow: 'Account access',
  title: 'Let’s get you into class.',
  description: `Only invited ${SCHOOL_NAME} learners and staff can use ${PRODUCT_NAME}.`,
}

export function SignInPage() {
  const { accessDenied } = useAuthContext()

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
        description={`Use the email address your ${SCHOOL_NAME} invitation was sent to.`}
        switchLink={<LinkButton to="/sign-up" variant="quiet" shape="brand" className="px-3 text-ink">I have an invitation</LinkButton>}
      >
        <AuthWidgetStatus />
        <SignIn
          appearance={clerkAuthAppearance}
          routing="hash"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
        />
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

export function SignUpPage() {
  const { accessDenied } = useAuthContext()
  const location = useLocation()
  const fromInvitation = hasInvitationTicket(location.search)

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
        eyebrow={fromInvitation ? 'Your invitation' : 'Have an invitation?'}
        title={fromInvitation ? 'Accept your invitation.' : 'Create your account.'}
        description={fromInvitation
          ? 'Your invited email is already filled in. Finish creating your account and your course will be waiting.'
          : `Use the email address your ${SCHOOL_NAME} invitation was sent to. If you already have an account, sign in instead.`}
        switchLink={<LinkButton to="/sign-in" variant="quiet" shape="brand" className="px-3 text-ink">Sign in</LinkButton>}
      >
        <AuthWidgetStatus />
        <SignUp
          appearance={clerkAuthAppearance}
          routing="hash"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
        />
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

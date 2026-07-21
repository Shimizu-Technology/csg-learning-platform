import { SignIn, SignUp, useClerk, useUser } from '@clerk/clerk-react'
import { useAuthContext } from '../contexts/AuthContext'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, BookOpenText, CheckCircle2, GraduationCap, Loader2, LogOut, MessageCircle, PlayCircle, RefreshCw, ShieldX } from 'lucide-react'
import { useState, type ReactNode } from 'react'

function AuthShell({
  description,
  children,
}: {
  description: string
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-[#f7f4ef] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-3.5rem)] lg:grid-cols-[0.88fr_1.12fr]">
        <section className="relative hidden overflow-hidden bg-[#17191f] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(239,68,68,0.23),transparent_32%),radial-gradient(circle_at_90%_80%,rgba(132,145,104,0.17),transparent_30%)]" />
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="relative">
            <Link to="/" className="inline-flex min-h-11 items-center gap-3 rounded-xl pr-3 font-extrabold tracking-tight text-white transition-opacity hover:opacity-80">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-600"><GraduationCap className="h-5 w-5" /></span>
              CSG Learning
            </Link>
            <p className="mt-20 max-w-md text-4xl font-extrabold leading-tight tracking-[-0.045em]">
              Your class is already organized. Just pick up the path.
            </p>
            <div className="mt-10 space-y-5">
              {[
                [BookOpenText, 'Continue from the exact lesson you need'],
                [PlayCircle, 'Resume recordings without losing your place'],
                [MessageCircle, 'Keep class questions and updates in context'],
              ].map(([Icon, label]) => {
                const ItemIcon = Icon as typeof BookOpenText
                return (
                  <div key={label as string} className="flex items-center gap-3 text-sm font-semibold text-slate-300">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><ItemIcon className="h-4 w-4 text-primary-300" /></span>
                    {label as string}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="relative flex items-center gap-2 text-xs font-semibold text-white/50">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            Built for Code School of Guam cohorts
          </div>
        </section>

        <section className="flex min-w-0 flex-col">
          <div className="flex min-h-16 items-center justify-between border-b border-slate-200/80 px-4 sm:px-7 lg:border-b-0">
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
              <ArrowLeft className="h-4 w-4" />
              Back home
            </Link>
            <div className="inline-flex items-center gap-2 font-extrabold tracking-tight text-slate-950 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white"><GraduationCap className="h-4 w-4" /></span>
              CSG Learning
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center px-3 py-8 sm:px-8 lg:py-12">
            <div className="w-full max-w-md">
              <div className="mb-6 px-2 text-center">
                <p className="app-eyebrow">Welcome to class</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
              </div>
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
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
    <div className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="border-b border-primary-100 bg-primary-50/70 px-6 py-7 text-center sm:px-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-[0_12px_28px_rgba(220,38,38,0.22)]">
          <ShieldX className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-950">This account isn’t on the class list</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-600">
          {sessionError || 'CSG Learning is invite-only. Ask a Code School administrator to add the email you use to sign in.'}
        </p>
      </div>
      <div className="space-y-4 px-6 py-6 sm:px-8">
        {email && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Signed in as</p>
            <p className="mt-1 break-all text-sm font-semibold text-slate-800">{email}</p>
          </div>
        )}
        <p className="text-center text-xs leading-5 text-slate-500">
          If an administrator just invited this address, check again. Otherwise, use the exact email from your Code School invitation.
        </p>
        <button
          type="button"
          onClick={() => void handleCheckAccess()}
          disabled={checking || signingOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {checking ? 'Checking access…' : 'I’ve been invited — check again'}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={checking || signingOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {signingOut ? 'Signing out…' : 'Use a different account'}
        </button>
      </div>
    </div>
  )
}

const authAppearance = {
  variables: {
    colorPrimary: '#dc2626',
    borderRadius: '0.875rem',
    fontFamily: '"Manrope Variable", "Avenir Next", sans-serif',
  },
  elements: {
    rootBox: 'mx-auto',
    card: 'shadow-none border border-slate-200 rounded-2xl',
    headerTitle: 'font-extrabold tracking-tight text-slate-950',
    headerSubtitle: 'text-slate-500',
    formButtonPrimary: 'min-h-11 rounded-xl bg-primary-600 font-bold hover:bg-primary-700',
    formFieldInput: 'min-h-11 rounded-xl border-slate-300 focus:border-primary-500 focus:ring-primary-100',
    footerActionLink: 'font-bold text-primary-700 hover:text-primary-800',
  },
}

export function SignInPage() {
  const { accessDenied } = useAuthContext()

  if (accessDenied) {
    return (
      <AuthShell description="Private access for active Code School of Guam students and staff.">
        <AccessDeniedCard />
      </AuthShell>
    )
  }

  return (
    <RedirectIfSignedIn>
      <AuthShell description="Private access for invited Code School of Guam students and staff.">
        <SignIn
          appearance={authAppearance}
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

  if (accessDenied) {
    return (
      <AuthShell description="Private access for active Code School of Guam students and staff.">
        <AccessDeniedCard />
      </AuthShell>
    )
  }

  return (
    <RedirectIfSignedIn>
      <AuthShell description="Create your account with the exact email address from your Code School invitation.">
        <SignUp
          appearance={authAppearance}
          routing="hash"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
        />
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

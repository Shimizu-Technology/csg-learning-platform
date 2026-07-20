import { SignIn, SignUp } from '@clerk/clerk-react'
import { useAuthContext } from '../contexts/AuthContext'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, BookOpenText, CheckCircle2, GraduationCap, MessageCircle, PlayCircle } from 'lucide-react'
import type { ReactNode } from 'react'

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
  const { isSignedIn } = useAuthContext()

  if (isSignedIn) {
    return <Navigate to="/dashboard" replace />
  }

  return children
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
  return (
    <RedirectIfSignedIn>
      <AuthShell description="Sign in to access the Code School of Guam learning platform.">
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
  return (
    <RedirectIfSignedIn>
      <AuthShell description="Create your Code School of Guam learning account.">
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

import { SignIn, SignUp } from '@clerk/clerk-react'
import { useAuthContext } from '../contexts/AuthContext'
import { Navigate } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import type { ReactNode } from 'react'

function AuthShell({
  description,
  children,
}: {
  description: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <GraduationCap className="h-12 w-12 text-primary-500 mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">CSG Learning Hub</h1>
        <p className="text-sm text-slate-500 mb-6">{description}</p>
        {children}
      </div>
    </div>
  )
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuthContext()

  if (isSignedIn) {
    return <Navigate to="/" replace />
  }

  return children
}

const authAppearance = {
  elements: {
    rootBox: 'mx-auto',
    card: 'shadow-none',
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
          afterSignInUrl="/"
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
          afterSignUpUrl="/"
        />
      </AuthShell>
    </RedirectIfSignedIn>
  )
}

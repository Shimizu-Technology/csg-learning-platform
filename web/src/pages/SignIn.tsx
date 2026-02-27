import { SignIn } from '@clerk/clerk-react'
import { useAuthContext } from '../contexts/AuthContext'
import { Navigate } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'

export function SignInPage() {
  const { isClerkEnabled, isSignedIn } = useAuthContext()

  // If already signed in, redirect
  if (isSignedIn) {
    return <Navigate to="/" replace />
  }

  // In dev mode without Clerk, show a simple message
  if (!isClerkEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <GraduationCap className="h-12 w-12 text-primary-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900">CSG Learning Platform</h1>
          <p className="mt-2 text-slate-500">Dev mode — authentication bypassed</p>
          <a href="/" className="mt-4 inline-block text-primary-600 hover:underline">Go to Dashboard</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <GraduationCap className="h-12 w-12 text-primary-500 mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">CSG Learn</h1>
        <p className="text-sm text-slate-500 mb-6">Sign in to access the Code School of Guam Learning Platform.</p>
        <SignIn
          appearance={{
            elements: {
              rootBox: 'mx-auto',
              card: 'shadow-none',
            }
          }}
          routing="hash"
          signUpUrl="/sign-up"
          afterSignInUrl="/"
        />
      </div>
    </div>
  )
}

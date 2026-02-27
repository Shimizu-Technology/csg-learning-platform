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

  // When Clerk is enabled, we would use SignIn component from Clerk
  // For now, show a redirect message
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-sm mx-auto text-center">
        <GraduationCap className="h-12 w-12 text-primary-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
        <p className="mt-2 text-sm text-slate-500">Please sign in to access the CSG Learning Platform.</p>
      </div>
    </div>
  )
}

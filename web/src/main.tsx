import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import { ClerkProvider } from '@clerk/clerk-react'
import { AuthProvider } from './contexts/AuthContext'
import { PostHogProvider } from './providers/PostHogProvider'
import App from './App'
import './index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ConfigurationError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Clerk configuration missing</h1>
        <p className="mt-2 text-sm text-slate-600">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> before starting the frontend. This app no longer supports a no-auth bypass mode.
        </p>
      </div>
    </div>
  )
}

function Root() {
  if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY === 'YOUR_PUBLISHABLE_KEY') {
    return <ConfigurationError />
  }

  return (
    <PostHogProvider>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <AuthProvider>
          <App />
        </AuthProvider>
      </ClerkProvider>
    </PostHogProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        void registration.update()
      })
      .catch((err) => console.log('SW registration failed:', err))
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(registerServiceWorker, { timeout: 2000 })
  } else {
    globalThis.setTimeout(registerServiceWorker, 1)
  }
}

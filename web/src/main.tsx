import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import { ClerkProvider } from '@clerk/clerk-react'
import { AuthProvider } from './contexts/AuthContext'
import { AppErrorBoundary } from './components/shared/AppErrorBoundary'
import App from './App'
import { clerkAppearanceFor, clerkLocalizationFor, useClerkAuthMode } from './lib/clerkAppearance'
import { initTheme, useTheme } from './lib/theme'
import './index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ConfigurationError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken px-4">
      <div className="max-w-md rounded-2xl border border-danger-line bg-surface-raised p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">Clerk configuration missing</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> before starting the frontend. This app no longer supports a no-auth bypass mode.
        </p>
      </div>
    </div>
  )
}

function Root() {
  const { theme } = useTheme()
  const authMode = useClerkAuthMode()
  const appearance = useMemo(() => clerkAppearanceFor(theme), [theme])
  const localization = useMemo(() => clerkLocalizationFor(authMode), [authMode])
  if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY === 'YOUR_PUBLISHABLE_KEY') {
    return <ConfigurationError />
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" appearance={appearance} localization={localization}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ClerkProvider>
  )
}

// index.html already set data-theme; this keeps it in step with the OS and other tabs.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Root />
    </AppErrorBoundary>
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

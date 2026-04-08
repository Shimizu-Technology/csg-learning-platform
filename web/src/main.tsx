import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { AuthProvider } from './contexts/AuthContext'
import { PostHogProvider } from './providers/PostHogProvider'
import App from './App'
import './index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const isClerkEnabled = Boolean(PUBLISHABLE_KEY && PUBLISHABLE_KEY !== 'YOUR_PUBLISHABLE_KEY')

if (!isClerkEnabled) {
  console.warn('Clerk not configured — running in dev bypass mode. Add VITE_CLERK_PUBLISHABLE_KEY to .env.local')
}

function Root() {
  if (isClerkEnabled) {
    return (
      <PostHogProvider>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <AuthProvider isClerkEnabled={true}>
            <App />
          </AuthProvider>
        </ClerkProvider>
      </PostHogProvider>
    )
  }

  return (
    <PostHogProvider>
      <AuthProvider isClerkEnabled={false}>
        <App />
      </AuthProvider>
    </PostHogProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch((err) => console.log('SW registration failed:', err))
  })
}

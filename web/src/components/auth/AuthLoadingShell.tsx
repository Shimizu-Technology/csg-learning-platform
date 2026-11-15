import { PublicFooter, PublicHeader } from '../brand/PublicChrome'
import { AuthWidgetLoading } from './AuthWidgetStatus'

/**
 * Shown while the sign-in or sign-up page's code loads: the public page with
 * a sign-in card placeholder, never the app's dashboard skeleton (S-19).
 */
export function AuthLoadingShell() {
  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink" data-testid="auth-loading-shell">
      <PublicHeader />
      <main className="safe-px mx-auto grid w-full max-w-[1200px] flex-1 gap-8 py-8 sm:py-12 lg:grid-cols-[1fr_minmax(0,440px)] lg:items-center lg:gap-16 lg:py-16">
        <div className="hidden lg:block" aria-hidden="true" />
        <div className="w-full min-w-0"><AuthWidgetLoading /></div>
      </main>
      <PublicFooter />
    </div>
  )
}

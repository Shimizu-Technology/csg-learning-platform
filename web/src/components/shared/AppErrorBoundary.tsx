import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import posthog from 'posthog-js'
import { isPostHogEnabled } from '../../providers/PostHogProvider'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  failed: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isPostHogEnabled) {
      posthog.captureException(error, {
        source: 'react_error_boundary',
        react_component_stack: info.componentStack,
      })
    }
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
        <section
          aria-labelledby="app-error-title"
          className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-8"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-950 text-primary-200">
            <AlertTriangle aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary-200">CSG Learning</p>
          <h1 id="app-error-title" className="mt-2 text-2xl font-extrabold tracking-tight">Something went wrong</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Your work is still safe. Reload the app to reconnect and continue.
          </p>
          <button
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-primary-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={this.reload}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Reload CSG Learning
          </button>
        </section>
      </main>
    )
  }
}

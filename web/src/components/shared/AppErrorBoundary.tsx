import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { withPostHog } from '../../lib/posthogClient'
import { PRODUCT_NAME } from '../../lib/brand'
import { Button } from '../ui/Button'

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
    withPostHog((posthog) => {
      posthog.captureException(error, {
        source: 'react_error_boundary',
        react_component_stack: info.componentStack,
      })
    })
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-12 text-ink">
        <section
          aria-labelledby="app-error-title"
          className="app-surface w-full max-w-lg p-6 sm:p-8"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-50 text-warning-800">
            <AlertTriangle aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="app-eyebrow mt-6">{PRODUCT_NAME}</p>
          <h1 id="app-error-title" className="mt-2 text-2xl font-bold tracking-tight">Something went wrong</h1>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            Your work is still safe. Reload the app to reconnect and continue.
          </p>
          <Button className="mt-6" fullWidth onClick={this.reload}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Reload {PRODUCT_NAME}
          </Button>
        </section>
      </main>
    )
  }
}

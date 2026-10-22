import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/Button'

export interface Section<T> {
  data: T | null
  error: string | null
  status: 'loading' | 'success' | 'error'
  retry: () => void
  update: (transform: (data: T) => T) => void
}

// Each source settles independently. Key changes hide old results immediately;
// the generation also protects retries and unmounts from late responses.
export function useSection<T>(key: string | null, fetcher: () => Promise<T>): Section<T> {
  const generation = useRef(0)
  const [state, setState] = useState<{
    key: string | null
    data: T | null
    error: string | null
    status: Section<T>['status']
  }>({ key: null, data: null, error: null, status: 'loading' })
  const retry = useCallback(() => {
    const request = ++generation.current
    setState({ key, data: null, error: null, status: 'loading' })
    if (!key) return
    void Promise.resolve()
      .then(fetcher)
      .then((data) => {
        if (request === generation.current) setState({ key, data, error: null, status: 'success' })
      })
      .catch((error: unknown) => {
        if (request === generation.current)
          setState({ key, data: null, error: error instanceof Error ? error.message : 'Unavailable', status: 'error' })
      })
  }, [key, fetcher])
  useEffect(() => {
    retry()
    return () => {
      generation.current += 1
    }
  }, [retry])
  const update = (transform: (data: T) => T) =>
    setState((current) =>
      current.key === key && current.data !== null ? { ...current, data: transform(current.data) } : current
    )
  return { ...(state.key === key ? state : { data: null, error: null, status: 'loading' as const }), retry, update }
}

export function SectionBoundary({
  section,
  label,
  children,
  className = '',
}: {
  section: Pick<Section<unknown>, 'status' | 'retry' | 'error'>
  label: string
  children: ReactNode
  className?: string
}) {
  if (section.status === 'success') return children
  return (
    <section aria-label={label} className={`app-surface p-5 ${className}`}>
      <h2 className="text-sm font-bold text-ink">{label}</h2>
      {section.status === 'loading' ? (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          Loading…
        </p>
      ) : (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-sm text-danger-700">
          <div>
            <span>Couldn't load —</span>
            {section.error && <p className="mt-1 text-xs">{section.error}</p>}
          </div>
          <Button variant="secondary" onClick={section.retry} aria-label={`Retry ${label}`}>
            Retry
          </Button>
        </div>
      )}
    </section>
  )
}

export function requireSection<T>(result: { data: T | null; error: string | null }): T {
  if (!result.data || result.error) throw new Error(result.error || 'Unavailable')
  return result.data
}

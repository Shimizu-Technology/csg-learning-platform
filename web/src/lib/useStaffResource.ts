import { useCallback, useEffect, useRef, useState } from 'react'

/** Keep successful data only within its scope; reject late requests and unmounted responses. */
export function useStaffResource<T>(scope: string, loader: () => Promise<{ data?: T | null; error?: string | null; fromCache?: boolean }>) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const generation = useRef(0)
  const [state, setState] = useState<{ scope: string; data: T | null; error: string | null; loading: boolean }>({ scope, data: null, error: null, loading: true })
  const reload = useCallback(async () => {
    const key = scopeRef.current
    const request = ++generation.current
    setState((current) => ({ scope: key, data: current.scope === key ? current.data : null, error: null, loading: true }))
    try {
      const result = await loaderRef.current()
      if (request !== generation.current || key !== scopeRef.current) return
      setState((current) => result.data
        ? { scope: key, data: result.data, error: result.error || (result.fromCache ? 'Showing saved data. Reconnect to refresh.' : null), loading: false }
        : { ...current, loading: false, error: result.error || 'Could not load this view.' })
    } catch (error) {
      if (request !== generation.current || key !== scopeRef.current) return
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Could not load this view.' }))
    }
  }, [])
  useEffect(() => {
    void reload()
    return () => { generation.current += 1 }
  }, [scope, reload])
  return { data: state.scope === scope ? state.data : null, error: state.scope === scope ? state.error : null, loading: state.scope !== scope || state.loading, reload }
}

import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MessageSearchResult } from './types';

export type MessageSearchStatus = 'idle' | 'loading' | 'done' | 'error'

type Resolved = { query: string; results: MessageSearchResult[]; failed: boolean }

/**
 * Inbox search: whether it's open, the query, debounced results, and where the
 * search is (so it is never silently blank). Results are shown only for the
 * query currently typed: while an edit waits for its search, earlier hits are
 * gone (loading, or "type at least 2 letters"), never still clickable.
 */
export function useMessageSearch() {
  const [showInboxSearch, setShowInboxSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  useEffect(() => {
    const trimmed = deferredSearchQuery.trim()
    if (trimmed.length < 2) return

    let current = true
    const timer = window.setTimeout(async () => {
      const res = await api.searchMessages(trimmed, 20)
      if (!current) return
      setResolved(res.data ? { query: trimmed, results: res.data.results, failed: false } : { query: trimmed, results: [], failed: true })
    }, 250)

    return () => { current = false; window.clearTimeout(timer) }
  }, [deferredSearchQuery])

  const trimmed = searchQuery.trim()
  const current = trimmed.length >= 2 && resolved?.query === trimmed ? resolved : null
  const searchResults = current?.results ?? []
  const searchStatus: MessageSearchStatus = trimmed.length < 2 ? 'idle' : !current ? 'loading' : current.failed ? 'error' : 'done'
  // Closing search forgets the last results.
  const clearSearchResults = useCallback(() => setResolved(null), [])

  return { showInboxSearch, setShowInboxSearch, searchQuery, setSearchQuery, searchResults, clearSearchResults, searchStatus }
}

export type MessageSearch = ReturnType<typeof useMessageSearch>

import { useDeferredValue, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MessageSearchResult } from './types';

export type MessageSearchStatus = 'idle' | 'loading' | 'done' | 'error'

/** Inbox search: whether it's open, the query, debounced results, and where the search is (so it is never silently blank). */
export function useMessageSearch() {
  const [showInboxSearch, setShowInboxSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<MessageSearchStatus>('idle')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  useEffect(() => {
    const trimmed = deferredSearchQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      setSearchStatus('idle')
      return
    }

    let current = true
    setSearchStatus('loading')
    const timer = window.setTimeout(async () => {
      const res = await api.searchMessages(trimmed, 20)
      if (!current) return
      if (res.data) {
        setSearchResults(res.data.results)
        setSearchStatus('done')
      } else {
        setSearchResults([])
        setSearchStatus('error')
      }
    }, 250)

    return () => { current = false; window.clearTimeout(timer) }
  }, [deferredSearchQuery])

  return { showInboxSearch, setShowInboxSearch, searchQuery, setSearchQuery, searchResults, setSearchResults, searchStatus }
}

export type MessageSearch = ReturnType<typeof useMessageSearch>

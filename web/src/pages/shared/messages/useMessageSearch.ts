import { useDeferredValue, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MessageSearchResult } from './types';

/** Inbox search: whether it's open, the query, and debounced results. */
export function useMessageSearch() {
  const [showInboxSearch, setShowInboxSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const deferredSearchQuery = useDeferredValue(searchQuery)
  useEffect(() => {
    const trimmed = deferredSearchQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      return
    }

    const timer = window.setTimeout(async () => {
      const res = await api.searchMessages(trimmed, 20)
      if (res.data) setSearchResults(res.data.results)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [deferredSearchQuery])

  return { showInboxSearch, setShowInboxSearch, searchQuery, setSearchQuery, searchResults, setSearchResults }
}

export type MessageSearch = ReturnType<typeof useMessageSearch>

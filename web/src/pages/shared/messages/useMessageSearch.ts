import { useDeferredValue, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MessageSearchResult } from './types';

export function useMessageSearch() {
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

  return { searchQuery, setSearchQuery, searchResults, setSearchResults }
}

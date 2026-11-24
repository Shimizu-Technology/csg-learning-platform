import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import type { DirectoryUserSummary as UserSummary } from '../../../types/api'

export type DirectRecipientsStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Who can get a new direct message in the current workspace, and who is
 * picked. Both belong to one workspace: a response for a workspace that is no
 * longer current is dropped, and a selection made in another workspace is
 * never shown or sent. A failed load is an error (with retry), not an empty
 * directory.
 */
export function useDirectRecipients(workspaceId: number | null) {
  const [loaded, setLoaded] = useState<{ workspaceId: number; users: UserSummary[] } | null>(null)
  const [failedFor, setFailedFor] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ workspaceId: number | null; ids: number[] }>({ workspaceId: null, ids: [] })
  const generation = useRef(0)

  const load = useCallback(async (id: number) => {
    const request = ++generation.current
    setFailedFor(null)
    const res = await api.getAvailableDirectUsers(id).catch(() => null)
    if (request !== generation.current) return
    if (res?.data) setLoaded({ workspaceId: id, users: res.data.users })
    else setFailedFor(id)
  }, [])

  useEffect(() => {
    if (workspaceId) void load(workspaceId)
    else generation.current++
  }, [workspaceId, load])

  const users = loaded && loaded.workspaceId === workspaceId ? loaded.users : []
  const status: DirectRecipientsStatus = !workspaceId ? 'idle' : failedFor === workspaceId ? 'error' : loaded?.workspaceId === workspaceId ? 'ready' : 'loading'
  const selectedIds = status === 'ready' && selection.workspaceId === workspaceId ? selection.ids.filter((id) => users.some((user) => user.id === id)) : []
  const setSelectedIds = useCallback((ids: number[]) => setSelection({ workspaceId, ids }), [workspaceId])
  const retry = useCallback(() => { if (workspaceId) void load(workspaceId) }, [workspaceId, load])

  return { users, status, selectedIds, setSelectedIds, retry }
}

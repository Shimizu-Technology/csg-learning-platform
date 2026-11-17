import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { readReturnContext } from '../../../lib/navigationContext';
import { safeInternalReturnPath, staffMessageSourcePath } from '../../../lib/routes';

/** What the URL asks for: the conversation, a message to open at, a workspace, and the record a staff member came from. */
export function useMessagesRoute() {
  const { channelId, dmId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const rememberedReturn = navigationType === 'POP' ? readReturnContext(location.state) : null
  const returnUrl = rememberedReturn ? new URL(rememberedReturn.returnTo, 'https://csg.invalid') : null
  const destinationParams = returnUrl?.pathname === location.pathname ? returnUrl.searchParams : searchParams
  const routedMessageId = Number(destinationParams.get('message_id') ?? destinationParams.get('messageId')) || null
  const routedThreadId = Number(destinationParams.get('thread_id')) || null
  const requestedAnchorOffset = destinationParams.has('message_offset') ? Number(destinationParams.get('message_offset')) : NaN
  const routedAnchorOffset = Number.isFinite(requestedAnchorOffset) && Math.abs(requestedAnchorOffset) <= 10000 ? requestedAnchorOffset : undefined
  const requestedWorkspaceId = Number(searchParams.get('workspace_id')) || null
  const routedDestinationKey = `${routedMessageId}:${routedThreadId}:${routedAnchorOffset}`
  const [sourceContextHidden, setSourceContextHidden] = useState(false)
  const sourceRecord = useMemo(() => {
    if (sourceContextHidden) return null
    const type = searchParams.get('source_type')
    const id = Number(searchParams.get('source_id'))
    const label = searchParams.get('source_label')?.trim()
    if ((type !== 'submission' && type !== 'help_request' && type !== 'intervention') || !Number.isInteger(id) || id <= 0 || !label) return null
    // The source record's own return path (a support or grading queue), so its Back link still goes there.
    const returnTo = safeInternalReturnPath(searchParams.get('source_return_to'), '') || undefined
    return { type, id, label, returnTo } as const
  }, [searchParams, sourceContextHidden])
  const sourceRecordPath = sourceRecord ? staffMessageSourcePath(sourceRecord, sourceRecord.returnTo) : null

  useEffect(() => { setSourceContextHidden(false) }, [searchParams])

  return {
    channelId,
    dmId,
    navigate,
    locationSearch: location.search,
    routedMessageId,
    routedThreadId,
    routedAnchorOffset,
    routedDestinationKey,
    requestedWorkspaceId,
    sourceRecord,
    sourceRecordPath,
    setSourceContextHidden,
  }
}

export type MessagesRoute = ReturnType<typeof useMessagesRoute>

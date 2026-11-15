import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChannelMessage } from '../../../types/api';
import type { LocalMessage } from './types';

/** Sheets and dialogs opened from a message: author context, reactions, the actions sheet and delete confirmation. */
export function useMessageOverlays(actionableMessagesById: Map<number, LocalMessage>) {
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null)
  const [authorContext, setAuthorContext] = useState<ChannelMessage['author'] | null>(null)
  const authorContextRef = useRef(authorContext)
  useLayoutEffect(() => { authorContextRef.current = authorContext }, [authorContext])
  const [mobileActionsMessageId, setMobileActionsMessageId] = useState<number | null>(null)
  /** Was the actions sheet opened from the desktop thread panel? Edit opens there, not in the feed. */
  const actionsFromThreadPanelRef = useRef(false)
  const [messagePendingDelete, setMessagePendingDelete] = useState<LocalMessage | null>(null)

  const mobileActionsMessage = mobileActionsMessageId ? actionableMessagesById.get(mobileActionsMessageId) || null : null
  const reactionDetailsMessage = reactionDetails ? actionableMessagesById.get(reactionDetails.messageId) || null : null
  const selectedReaction = reactionDetailsMessage?.reactions.find((reaction) => reaction.emoji === reactionDetails?.emoji)
    || reactionDetailsMessage?.reactions[0]
    || null

  useEffect(() => {
    if (mobileActionsMessageId && !actionableMessagesById.has(mobileActionsMessageId)) {
      setMobileActionsMessageId(null)
    }
  }, [actionableMessagesById, mobileActionsMessageId])

  return {
    reactionDetails,
    setReactionDetails,
    reactionDetailsMessage,
    selectedReaction,
    authorContext,
    setAuthorContext,
    authorContextRef,
    mobileActionsMessage,
    setMobileActionsMessageId,
    actionsFromThreadPanelRef,
    messagePendingDelete,
    setMessagePendingDelete,
  }
}

export type MessageOverlays = ReturnType<typeof useMessageOverlays>

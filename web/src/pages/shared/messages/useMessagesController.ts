import { useAuthContext } from '../../../contexts/AuthContext';
import { useCohortContext } from '../../../contexts/CohortContext';
import { useToast } from '../../../contexts/ToastContext';
import { useAttachmentLightbox } from './useAttachmentLightbox';
import { useBrowserAlerts } from './useBrowserAlerts';
import { useComposerAttachments } from './useComposerAttachments';
import { useConversationState } from './useConversationState';
import { useConversationWindow } from './useConversationWindow';
import { useMessageMutations } from './useMessageMutations';
import { useMessageOverlays } from './useMessageOverlays';
import { useMessageSearch } from './useMessageSearch';
import { useMessagesRealtime } from './useMessagesRealtime';
import { useMessagesRoute } from './useMessagesRoute';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';

/**
 * Composes the page's hooks. The call order is the order their effects run in
 * (see README.md): the directory's list load starts before the window's first
 * conversation load, and realtime subscribes after both.
 */
export function useMessagesController() {
  const { user } = useAuthContext()
  const cohorts = useCohortContext()
  const toast = useToast()
  const route = useMessagesRoute()
  const conversation = useConversationState(route)
  const overlays = useMessageOverlays(conversation.actionableMessagesById)
  const search = useMessageSearch()
  const lightbox = useAttachmentLightbox()
  const attachments = useComposerAttachments(user?.id, conversation.selectedTarget, conversation.activeThreadRootId)
  const directory = useWorkspaceDirectory(user, toast, cohorts, route, conversation)
  const alerts = useBrowserAlerts()
  const feed = useConversationWindow({
    user,
    toast,
    route,
    conversation,
    directory,
    authorContextRef: overlays.authorContextRef,
    readingPaused: Boolean(lightbox.lightboxAttachment || overlays.reactionDetails),
    releaseOptimisticAttachmentUrls: attachments.releaseOptimisticAttachmentUrls,
  })
  const realtime = useMessagesRealtime({
    userId: user?.id,
    selectedTarget: conversation.selectedTarget,
    selectedTargetRef: conversation.selectedTargetRef,
    selectedConversationKey: conversation.selectedConversationKey,
    activeThreadRootId: conversation.activeThreadRootId,
    activeThreadRootIdRef: conversation.activeThreadRootIdRef,
    onMessageEvent: feed.applyRealtimeEvent,
    refreshInBackground: feed.refreshInBackground,
  })
  const mutations = useMessageMutations({
    user,
    toast,
    sourceRecord: route.sourceRecord,
    conversation,
    feed,
    attachments,
    mentionableUsers: directory.mentionableUsers,
    updateLatestForTarget: directory.updateLatestForTarget,
  })

  return { toast, route, conversation, overlays, search, lightbox, attachments, directory, alerts, feed, realtime, mutations }
}

export type MessagesController = ReturnType<typeof useMessagesController>

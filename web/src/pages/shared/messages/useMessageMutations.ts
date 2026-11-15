import { useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { brand } from '../../../lib/brand';
import { copyText } from '../../../lib/clipboard';
import { createClientMessageId, MESSAGE_BODY_LIMIT, messageCharacterCount, type StoredMessageSource, type UploadedMessageAttachment } from '../../../lib/messageComposerState';
import { normalizeMessageMarkdown } from '../../../lib/messageFormat';
import type { MessageView as ChannelMessage, User } from '../../../types/api';
import { optimisticSource, removeStoredFailure, saveStoredFailure } from './failedSends';
import { conversationPath, sortChronologicalMessages, targetKey, targetMatches, upsertPinnedMessage } from './helpers';
import { resolveMentionedUserIds } from './mentions';
import type { MessageComposerHandle, MessageComposerSend } from './MessageComposer';
import type { LocalMessage, MentionableUser, PendingAttachment, RetrySend, Target } from './types';
import type { ComposerAttachments } from './useComposerAttachments';
import type { ConversationState } from './useConversationState';
import type { ConversationWindow } from './useConversationWindow';
import type { MessagesRoute } from './useMessagesRoute';

type Toast = { success: (message: string) => void; error: (message: string) => void }

export type MutationInputs = {
  user: User | null
  toast: Toast
  sourceRecord: MessagesRoute['sourceRecord']
  conversation: Pick<ConversationState, 'selectedTarget' | 'selectedTargetRef' | 'messages' | 'setMessages' | 'setPinnedMessages' | 'activeThreadRoot' | 'activeThreadRootId' | 'setActiveThreadRootId' | 'setEditing' | 'tempMessageIdRef'>
  feed: Pick<ConversationWindow, 'trackOwnSend' | 'queueHistoricalSend'>
  attachments: Pick<ComposerAttachments, 'pendingAttachments' | 'composerDraftKey' | 'fileInputRef' | 'clearSubmittedAttachments' | 'rememberOptimisticAttachmentUrls' | 'releaseOptimisticAttachmentUrls' | 'uploadAttachments'>
  mentionableUsers: MentionableUser[]
  /** Keeps the conversation list's latest message and unread count in step with a send. */
  updateLatestForTarget: (message: ChannelMessage) => void
}

/**
 * Changes to messages: sending (optimistic rows, failures saved for retry, and
 * the once-per-conversation source context), editing, deleting, reacting,
 * pinning, copying, reporting and blocking.
 */
export function useMessageMutations({ user, toast, sourceRecord, conversation, feed, attachments, mentionableUsers, updateLatestForTarget }: MutationInputs) {
  const { selectedTarget, selectedTargetRef, messages, setMessages, setPinnedMessages, activeThreadRoot, activeThreadRootId, setActiveThreadRootId, setEditing, tempMessageIdRef } = conversation
  const { pendingAttachments, composerDraftKey, fileInputRef, clearSubmittedAttachments, rememberOptimisticAttachmentUrls, releaseOptimisticAttachmentUrls, uploadAttachments } = attachments
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const composerRef = useRef<MessageComposerHandle | null>(null)
  /** Conversation and source pairs already attached to a sent message, so the context goes out once. */
  const sentSourceKeysRef = useRef(new Set<string>())
  /**
   * Conversation and source pairs attached to a send that hasn't succeeded yet,
   * by client message id. A failed send keeps its reservation while it can
   * still be retried; discarding it (or restoring its text) releases the
   * context for the next message.
   */
  const pendingSourceKeysRef = useRef(new Map<string, string>())

  /** Sends what the composer wrote. Returns false when nothing was sent, so the composer keeps the text. */
  const sendComposerMessage = ({ body: submittedBody, mentionUserIds }: MessageComposerSend) => {
    if (!selectedTarget || !user || sending) return false
    const submittedAttachments = pendingAttachments
    if (!submittedBody && submittedAttachments.length === 0) return false
    if (messageCharacterCount(submittedBody) > MESSAGE_BODY_LIMIT) return false
    void deliverComposerMessage(submittedBody, mentionUserIds, submittedAttachments)
    return true
  }

  /**
   * The record a staff member opened this conversation from (a submission or
   * help request), attached to the first top-level message they send here so
   * the learner sees what it's about (L-1.8). Once per conversation and record.
   */
  const messageSourceFor = (target: Target, threadRoot: LocalMessage | null, clientMessageId: string): StoredMessageSource | null => {
    if (target.type !== 'dm' || threadRoot || !sourceRecord) return null
    const key = `${targetKey(target)}:${sourceRecord.type}:${sourceRecord.id}`
    if (sentSourceKeysRef.current.has(key) || pendingSourceKeysRef.current.has(key) || messages.some((message) => message.source?.type === sourceRecord.type && message.source.id === sourceRecord.id)) return null
    pendingSourceKeysRef.current.set(key, clientMessageId)
    return { type: sourceRecord.type, id: sourceRecord.id, title: sourceRecord.label }
  }

  /** A send carrying a source succeeded: the context has gone out for good. */
  const confirmSourceReservation = (clientMessageId: string) => {
    for (const [key, owner] of pendingSourceKeysRef.current) {
      if (owner !== clientMessageId) continue
      pendingSourceKeysRef.current.delete(key)
      sentSourceKeysRef.current.add(key)
    }
  }

  /** A failed send was dropped, so the next message carries the context instead. */
  const releaseSourceReservation = (clientMessageId: string) => {
    for (const [key, owner] of pendingSourceKeysRef.current) {
      if (owner === clientMessageId) pendingSourceKeysRef.current.delete(key)
    }
  }

  const deliverComposerMessage = async (submittedBody: string, mentionUserIds: number[], submittedAttachments: PendingAttachment[]) => {
    if (!selectedTarget || !user) return
    const submittedTarget = selectedTarget
    const submittedDraftKey = composerDraftKey
    const threadRoot = activeThreadRoot
    const clientMessageId = createClientMessageId()
    const source = messageSourceFor(submittedTarget, threadRoot, clientMessageId)
    const retrySource = source ?? undefined

    tempMessageIdRef.current -= 1
    const tempId = tempMessageIdRef.current
    const optimisticUrls: string[] = []
    const optimisticAttachments = submittedAttachments.map((attachment, index) => {
      const url = URL.createObjectURL(attachment.file)
      optimisticUrls.push(url)

      return {
        id: tempId - index - 1,
        filename: attachment.filename,
        content_type: attachment.content_type,
        byte_size: attachment.byte_size,
        image: attachment.content_type.startsWith('image/'),
        url,
      }
    })
    rememberOptimisticAttachmentUrls(tempId, optimisticUrls)
    const optimisticMessage: LocalMessage = {
      id: tempId,
      channel_id: selectedTarget.type === 'channel' ? selectedTarget.id : null,
      direct_conversation_id: selectedTarget.type === 'dm' ? selectedTarget.id : null,
      parent_message_id: threadRoot?.id || null,
      client_message_id: clientMessageId,
      body: submittedBody,
      mention_user_ids: mentionUserIds,
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      pinned_by_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mine: true,
      pending: true,
      attachments: optimisticAttachments,
      reactions: [],
      source: source ? optimisticSource(source) : null,
      author: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    }

    feed.trackOwnSend(selectedTarget, optimisticMessage.parent_message_id, tempId)
    setMessages((prev) => sortChronologicalMessages([...prev, optimisticMessage]))
    updateLatestForTarget(optimisticMessage)
    clearSubmittedAttachments(submittedDraftKey)

    setSending(true)
    setError('')
    let uploadedAttachments: UploadedMessageAttachment[] = []
    try {
      uploadedAttachments = await uploadAttachments(submittedAttachments, submittedTarget)
      const payload = {
        body: submittedBody,
        parent_message_id: optimisticMessage.parent_message_id,
        client_message_id: clientMessageId,
        mention_user_ids: mentionUserIds,
        attachments: uploadedAttachments,
        send_push: true,
      }
      const res = submittedTarget.type === 'channel'
        ? await api.createMessage(submittedTarget.id, payload)
        : await api.createDirectMessage(submittedTarget.id, retrySource ? { ...payload, source_type: retrySource.type, source_id: retrySource.id } : payload)

      if (!res.data) {
        const failureError = res.error || 'Could not send message.'
        setError(failureError)
        toast.error(failureError)
        const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments, source: retrySource }
        saveStoredFailure(user, submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: failureError, ...(retrySource ? { source: retrySource } : {}) })
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true, failureError, retrySend } : item))
        }
      } else {
        const message = res.data.message
        confirmSourceReservation(clientMessageId)
        removeStoredFailure(user, submittedTarget, clientMessageId)
        releaseOptimisticAttachmentUrls(tempId)
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          const queued = feed.queueHistoricalSend(message)
          setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id && item.client_message_id !== clientMessageId), ...(queued ? [] : [message])]))
        }
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Could not send message.'
      setError(message)
      toast.error(message)
      const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments, source: retrySource }
      saveStoredFailure(user, submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: message, ...(retrySource ? { source: retrySource } : {}) })
      if (targetMatches(selectedTargetRef.current, submittedTarget)) {
        setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true, failureError: message, retrySend } : item))
      }
    }
    setSending(false)
  }

  const retryFailedMessage = async (message: LocalMessage) => {
    if (!selectedTarget || !message.retrySend || sending) return
    const target = selectedTarget
    const retry = message.retrySend
    setSending(true)
    setError('')
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, pending: true, failed: false } : item))
    let retryAttachments = retry.uploadedAttachments

    try {
      retryAttachments = retry.uploadedAttachments.length > 0
        ? retry.uploadedAttachments
        : await uploadAttachments(retry.pendingAttachments, target)
      const payload = {
        body: retry.body,
        parent_message_id: retry.parentMessageId,
        client_message_id: retry.clientMessageId,
        mention_user_ids: retry.mentionUserIds,
        attachments: retryAttachments,
        send_push: true,
      }
      const res = target.type === 'channel'
        ? await api.createMessage(target.id, payload)
        : await api.createDirectMessage(target.id, retry.source ? { ...payload, source_type: retry.source.type, source_id: retry.source.id } : payload)

      if (!res.data) throw new Error(res.error || 'Could not send message.')

      confirmSourceReservation(retry.clientMessageId)
      removeStoredFailure(user, target, retry.clientMessageId)
      releaseOptimisticAttachmentUrls(message.id)
      if (targetMatches(selectedTargetRef.current, target)) {
        const queued = feed.queueHistoricalSend(res.data.message)
        setMessages((current) => sortChronologicalMessages([
          ...current.filter((item) => item.id !== message.id && item.id !== res.data!.message.id && item.client_message_id !== retry.clientMessageId),
          ...(queued ? [] : [res.data!.message]),
        ]))
      }
      updateLatestForTarget(res.data.message)
    } catch (retryError) {
      const failureError = retryError instanceof Error ? retryError.message : 'Could not send message.'
      saveStoredFailure(user, target, {
        version: 1,
        clientMessageId: retry.clientMessageId,
        target,
        body: retry.body,
        parentMessageId: retry.parentMessageId,
        mentionUserIds: retry.mentionUserIds,
        attachments: retryAttachments,
        attachmentCount: Math.max(retry.pendingAttachments.length, retryAttachments.length),
        createdAt: message.created_at,
        error: failureError,
        ...(retry.source ? { source: retry.source } : {}),
      })
      if (targetMatches(selectedTargetRef.current, target)) {
        setMessages((current) => current.map((item) => item.id === message.id ? {
          ...item,
          pending: false,
          failed: true,
          failureError,
          retrySend: { ...retry, uploadedAttachments: retryAttachments },
        } : item))
      }
      setError(failureError)
      toast.error(failureError)
    } finally {
      setSending(false)
    }
  }

  const discardFailedMessage = (message: LocalMessage) => {
    if (!selectedTarget || !message.client_message_id) return
    removeStoredFailure(user, selectedTarget, message.client_message_id)
    releaseSourceReservation(message.client_message_id)
    releaseOptimisticAttachmentUrls(message.id)
    setMessages((current) => current.filter((item) => item.id !== message.id))
  }

  const restoreFailedMessageText = (message: LocalMessage) => {
    const insert = () => {
      if (message.body) composerRef.current?.insertMarkdown(message.body)
      discardFailedMessage(message)
      if (!message.body) fileInputRef.current?.click()
    }

    if (message.parent_message_id && activeThreadRootId !== message.parent_message_id) {
      setActiveThreadRootId(message.parent_message_id)
      window.requestAnimationFrame(insert)
    } else {
      insert()
    }
  }

  const saveEdit = async (message: ChannelMessage, editedBody: string) => {
    const normalizedBody = normalizeMessageMarkdown(editedBody)
    if (!normalizedBody || messageCharacterCount(normalizedBody) > MESSAGE_BODY_LIMIT) return

    const mentionUserIds = resolveMentionedUserIds(normalizedBody, mentionableUsers, message.mention_user_ids)
    const res = await api.updateMessage(message.id, { body: normalizedBody, mention_user_ids: mentionUserIds })
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
      setEditing(null)
      toast.success('Message updated')
    } else if (res.error) {
      setError(res.error)
      toast.error(res.error)
    }
  }

  const deleteMessage = async (message: ChannelMessage) => {
    const res = await api.deleteMessage(message.id)
    if (res.data) {
      releaseOptimisticAttachmentUrls(message.id)
      setMessages((prev) => prev.filter((item) => item.id !== message.id))
      setPinnedMessages((prev) => prev.filter((item) => item.id !== message.id))
      toast.success('Message deleted')
    }
    else if (res.error) {
      setError(res.error)
      toast.error(res.error)
    }
  }

  const copyMessage = async (message: ChannelMessage) => {
    if (!message.body) return

    try {
      await navigator.clipboard.writeText(message.body)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy message.')
    }
  }

  /** A link that opens this conversation scrolled to the message and highlights it (L-2.8). */
  const messageLink = (message: ChannelMessage) => {
    const target: Target | null = message.channel_id ? { type: 'channel', id: message.channel_id } : message.direct_conversation_id ? { type: 'dm', id: message.direct_conversation_id } : null
    return target && message.id > 0 ? `${window.location.origin}${conversationPath(target, message.id)}` : null
  }

  const copyMessageLink = async (message: ChannelMessage) => {
    const link = messageLink(message)
    if (!link) return
    if (await copyText(link)) toast.success('Link to message copied')
    else toast.error('Could not copy the link.')
  }

  const copyConversationLink = async () => {
    if (!selectedTarget) return
    if (await copyText(`${window.location.origin}${conversationPath(selectedTarget)}`)) toast.success('Link to conversation copied')
    else toast.error('Could not copy the link.')
  }

  const reportMessage = async (message: ChannelMessage) => {
    const res = await api.reportContent({ message_id: message.id, reason: 'inappropriate_content' })
    if (!res.data) return toast.error(res.error || 'Could not submit the report.')
    toast.success(`Report received. ${brand.schoolShortName} staff will review it.`)
  }

  const reportUser = async (message: ChannelMessage) => {
    const res = await api.reportContent({ reported_user_id: message.author.id, reason: 'safety_concern' })
    if (!res.data) return toast.error(res.error || 'Could not submit the user report.')
    toast.success(`User report received. ${brand.schoolShortName} staff will review it.`)
  }

  const blockMessageAuthor = async (message: ChannelMessage) => {
    const res = await api.blockUser(message.author.id)
    if (!res.data) return toast.error(res.error || 'Could not block this user.')
    const hideAuthor = (item: LocalMessage): LocalMessage => item.author.id === message.author.id
      ? { ...item, blocked: true, body: '', attachments: [], reactions: [] }
      : item
    setMessages((prev) => prev.map(hideAuthor))
    setPinnedMessages((prev) => prev.map(hideAuthor))
    toast.success(`${message.author.full_name} was blocked. You can unblock them from your profile.`)
  }

  const togglePin = async (message: ChannelMessage) => {
    const res = message.pinned_at ? await api.unpinMessage(message.id) : await api.pinMessage(message.id)
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
    }
  }

  const toggleReaction = async (message: ChannelMessage, emoji: string) => {
    const existing = message.reactions.find((reaction) => reaction.emoji === emoji)
    const res = existing?.reacted ? await api.unreactMessage(message.id, emoji) : await api.reactMessage(message.id, emoji)
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
    }
  }

  return {
    sending,
    error,
    composerRef,
    sendComposerMessage,
    retryFailedMessage,
    discardFailedMessage,
    restoreFailedMessageText,
    saveEdit,
    deleteMessage,
    copyMessage,
    copyMessageLink,
    copyConversationLink,
    reportMessage,
    reportUser,
    blockMessageAuthor,
    togglePin,
    toggleReaction,
  }
}

export type MessageMutations = ReturnType<typeof useMessageMutations>

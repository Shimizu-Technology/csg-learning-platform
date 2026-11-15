import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { isVisiblePage, shouldPollMessages } from '../../../lib/backgroundActivity';
import { isMessageTypingEvent, subscribeToUserMessages, type RealtimeSubscription } from '../../../lib/realtime';
import type { ChannelMessage, ChannelMessageEvent } from '../../../types/api';
import { typingIndicatorLabel } from './helpers';
import type { Target, TypingUser } from './types';

type RealtimeInputs = {
  userId: number | undefined
  selectedTarget: Target | null
  selectedTargetRef: RefObject<Target | null>
  selectedConversationKey: string | null
  activeThreadRootId: number | null
  activeThreadRootIdRef: RefObject<number | null>
  /** Applies a message event to summaries and the open window. */
  onMessageEvent: (event: ChannelMessageEvent, message: ChannelMessage) => void
  /** Reloads the open conversation while Cable can't be trusted (disconnected or hidden tab). */
  refreshInBackground: (target: Target) => Promise<void>
}

/**
 * The person's Cable subscription: message events, who is typing here, this
 * person's own typing presence, and polling while realtime is down.
 */
export function useMessagesRealtime({ userId, selectedTarget, selectedTargetRef, selectedConversationKey, activeThreadRootId, activeThreadRootIdRef, onMessageEvent, refreshInBackground }: RealtimeInputs) {
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [, setRealtimeSubscriptionVersion] = useState(0)
  const realtimeSubscriptionRef = useRef<RealtimeSubscription | null>(null)
  const typingExpiryTimersRef = useRef(new Map<number, number>())
  const typingStopTimerRef = useRef<number | null>(null)
  const outboundTypingRef = useRef<{
    target: Target
    threadRootId: number | null
    active: boolean
    lastSentAt: number
  } | null>(null)
  const typingLabel = typingIndicatorLabel(typingUsers)

  const refreshSelectedTarget = useEffectEvent(() => selectedTarget ? refreshInBackground(selectedTarget) : Promise.resolve())
  useEffect(() => {
    if (!selectedConversationKey) return

    const refreshTarget = async () => {
      await refreshSelectedTarget()
    }

    let interval: number | null = null
    const syncPolling = () => {
      const shouldPoll = shouldPollMessages(document.visibilityState, realtimeStatus)
      if (shouldPoll && interval === null) {
        interval = window.setInterval(() => void refreshTarget(), 30000)
      } else if (!shouldPoll && interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }
    const onFocus = () => void refreshTarget()
    const onVisibilityChange = () => {
      syncPolling()
      if (isVisiblePage(document.visibilityState)) void refreshTarget()
    }

    syncPolling()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (interval !== null) window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selectedConversationKey, realtimeStatus])

  const handleMessageEvent = useEffectEvent(onMessageEvent)
  useEffect(() => {
    if (!userId) return

    let unsubscribe: RealtimeSubscription | null = null
    let active = true
    const typingExpiryTimers = typingExpiryTimersRef.current

    setRealtimeStatus('disconnected')
    setTypingUsers([])

    subscribeToUserMessages((payload) => {
      if (!active) return
      if (isMessageTypingEvent(payload)) {
        const currentTarget = selectedTargetRef.current
        const belongsToTarget = Boolean(currentTarget) && (
          currentTarget!.type === 'channel'
            ? payload.channel_id === currentTarget!.id
            : payload.direct_conversation_id === currentTarget!.id
        )
        if (!belongsToTarget || payload.user.id === userId || payload.thread_root_id !== activeThreadRootIdRef.current) return

        const existingTimer = typingExpiryTimers.get(payload.user.id)
        if (existingTimer) window.clearTimeout(existingTimer)
        typingExpiryTimers.delete(payload.user.id)
        if (!payload.active) {
          setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== payload.user.id))
          return
        }

        setTypingUsers((current) => [payload.user, ...current.filter((typingUser) => typingUser.id !== payload.user.id)])
        const timer = window.setTimeout(() => {
          typingExpiryTimers.delete(payload.user.id)
          setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== payload.user.id))
        }, 5_000)
        typingExpiryTimers.set(payload.user.id, timer)
        return
      }

      const event = payload as ChannelMessageEvent
      if (!event.message) return

      const currentTarget = selectedTargetRef.current
      const belongsToTarget = Boolean(currentTarget) && (
        currentTarget!.type === 'channel'
          ? event.channel_id === currentTarget!.id
          : event.direct_conversation_id === currentTarget!.id
      )
      const message = { ...event.message, mine: event.message.mine ?? event.message.author.id === userId }
      if (belongsToTarget && message.parent_message_id === activeThreadRootIdRef.current) {
        const typingTimer = typingExpiryTimers.get(message.author.id)
        if (typingTimer) window.clearTimeout(typingTimer)
        typingExpiryTimers.delete(message.author.id)
        setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== message.author.id))
      }
      handleMessageEvent(event, message)
    }, (status) => {
      setRealtimeStatus(status)
      if (status === 'connected') setRealtimeSubscriptionVersion((current) => current + 1)
    }).then((cleanup) => {
      if (active) {
        unsubscribe = cleanup
        realtimeSubscriptionRef.current = cleanup
      }
      else cleanup()
    })

    return () => {
      active = false
      const outbound = outboundTypingRef.current
      if (outbound?.active) {
        unsubscribe?.perform('typing', {
          target_type: outbound.target.type,
          target_id: outbound.target.id,
          thread_root_id: outbound.threadRootId,
          active: false,
        })
      }
      outboundTypingRef.current = null
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
      realtimeSubscriptionRef.current = null
      unsubscribe?.()
      typingExpiryTimers.forEach((timer) => window.clearTimeout(timer))
      typingExpiryTimers.clear()
    }
  }, [userId, selectedTargetRef, activeThreadRootIdRef])

  /**
   * Typing presence from the composer, without page state: an "active" ping at
   * most every 2 seconds while there's text, "inactive" 4 seconds after the
   * last keystroke, when the text is cleared or sent, or on leaving.
   */
  const reportComposerTyping = useCallback((hasContent: boolean) => {
    const subscription = realtimeSubscriptionRef.current
    const target = selectedTargetRef.current
    const threadRootId = activeThreadRootIdRef.current
    const previous = outboundTypingRef.current
    const sameDestination = Boolean(previous && target
      && previous.target.type === target.type
      && previous.target.id === target.id
      && previous.threadRootId === threadRootId)

    const send = (outboundTarget: Target, outboundThreadRootId: number | null, active: boolean) => subscription?.perform('typing', {
      target_type: outboundTarget.type,
      target_id: outboundTarget.id,
      thread_root_id: outboundThreadRootId,
      active,
    }) ?? false

    if (previous?.active && (!sameDestination || !hasContent)) {
      send(previous.target, previous.threadRootId, false)
      outboundTypingRef.current = null
    }

    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current)
    typingStopTimerRef.current = null
    if (!subscription || !target || !hasContent) return

    const now = Date.now()
    if (!sameDestination || !previous?.active || now - previous.lastSentAt >= 2_000) {
      if (send(target, threadRootId, true)) {
        outboundTypingRef.current = { target, threadRootId, active: true, lastSentAt: now }
      }
    }

    typingStopTimerRef.current = window.setTimeout(() => {
      const latest = outboundTypingRef.current
      if (latest?.active) send(latest.target, latest.threadRootId, false)
      outboundTypingRef.current = null
      typingStopTimerRef.current = null
    }, 4_000)
  }, [selectedTargetRef, activeThreadRootIdRef])

  useEffect(() => {
    typingExpiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    typingExpiryTimersRef.current.clear()
    setTypingUsers([])
  }, [activeThreadRootId, selectedConversationKey])

  return { typingLabel, reportComposerTyping }
}

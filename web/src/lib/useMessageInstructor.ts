import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import { SUPPORT_EMAIL } from './brand'
import { prefillCourseQuestion } from './courseQuestion'
import { conversationPath } from './routes'
import { useAuthContext } from '../contexts/AuthContext'

export interface MessageTopic {
  /** What the conversation is about, e.g. the lesson title. */
  label: string
  /** An in-app path to it; the composer gets "Question about: [label](url)". */
  path: string
}

/**
 * "Message Audreana", "Ask about this feedback", "Ask Audreana for a catch-up
 * plan": opens the learner's conversation with that instructor in this cohort
 * (S-7, L-1.7), never an empty inbox. With a topic, the composer starts with a
 * link to it (L-1.8); nothing is sent. If the conversation can't be opened,
 * the school's support email opens instead.
 */
export function useMessageInstructor(cohortId: number | null | undefined) {
  const { user } = useAuthContext()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  // A result that arrives after the page is gone is ignored: no navigation, no state.
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const open = useCallback(async (instructorId: number | null | undefined, topic?: MessageTopic) => {
    if (opening) return
    const email = () => { if (active.current) window.location.href = `mailto:${SUPPORT_EMAIL}` }
    if (!user || !cohortId || !instructorId) { email(); return }
    setOpening(true)
    try {
      // A rejected request (no session token, offline) falls back the same way a refused one does.
      const result = await Promise.resolve().then(() => api.createDirectConversation({ cohort_id: cohortId, user_ids: [instructorId] })).catch(() => null)
      if (!active.current) return
      const conversation = result?.data?.direct_conversation
      if (!conversation || result?.fromCache) { email(); return }
      if (topic) {
        try { prefillCourseQuestion(user.id, conversation.id, topic.label, `${window.location.origin}${topic.path}`, window.localStorage) } catch { /* The conversation still opens without the link. */ }
      }
      navigate(conversationPath({ type: 'dm', id: conversation.id }, { cohortId }))
    } finally {
      if (active.current) setOpening(false)
    }
  }, [cohortId, navigate, opening, user])
  return { open, opening }
}

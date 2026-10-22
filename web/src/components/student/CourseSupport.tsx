import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { prefillCourseQuestion } from '../../lib/courseQuestion'
import { useAuthContext } from '../../contexts/AuthContext'
import type { LearnerCapabilities } from '../../types/api'
import { AnchorButton, Button } from '../ui/Button'
import { INVITATION_HELP_EMAIL } from '../auth/InvitationHelp'

export function CourseSupport({ capabilities, cohortId, contextLabel, contextPath }: {
  capabilities?: LearnerCapabilities; cohortId: number; contextLabel: string; contextPath?: string
}) {
  const { user } = useAuthContext()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentContext = `${user?.id}:${cohortId}:${contextLabel}:${contextPath}:${JSON.stringify(capabilities)}`
  const contextRef = useRef(currentContext)
  contextRef.current = currentContext
  useEffect(() => { contextRef.current = currentContext; return () => { contextRef.current = '' } }, [currentContext])
  const instructorId = capabilities?.support_instructor_id
  const active = capabilities?.support_mode === 'course_question' && Number.isInteger(instructorId) && instructorId! > 0

  async function openQuestion() {
    if (!active || !user || opening) return
    const context = currentContext
    setOpening(true)
    setError(null)
    try {
      const response = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [instructorId!] })
      if (context !== contextRef.current) return
      if (!response.data || response.fromCache) throw new Error(response.error || 'Could not open your instructor conversation. Try again.')
      const conversation = response.data.direct_conversation
      if (conversation.cohort_id !== cohortId) throw new Error('Could not open a conversation for this course. Try again.')
      if (!prefillCourseQuestion(user.id, conversation.id, contextLabel, contextPath || window.location.href, window.localStorage)) {
        throw new Error('Could not prepare your question on this device. Please try again or contact account support.')
      }
      navigate(`/messages/dm/${conversation.id}?cohort_id=${cohortId}`)
    } catch (failure) {
      if (context === contextRef.current) setError(failure instanceof Error ? failure.message : 'Could not open your instructor conversation. Try again.')
    } finally {
      setOpening(false)
    }
  }

  return <div className="space-y-2 text-sm text-ink-secondary">
    {active ? <Button variant="secondary" disabled={opening} onClick={() => void openQuestion()}>{opening ? 'Opening conversation…' : 'Ask a course question'}</Button>
      : <p>{capabilities?.support_expires_at ? `Instructor support ended ${formatShortDate(capabilities.support_expires_at)}.` : 'Instructor support is unavailable for this course.'}</p>}
    {error && <p role="alert" className="text-danger-700">{error}</p>}
    {!active || error ? <AnchorButton variant="quiet" size="sm" href={`mailto:${INVITATION_HELP_EMAIL}?subject=CSG%20Learn%20account%20support`}>Technical or account support</AnchorButton> : null}
  </div>
}

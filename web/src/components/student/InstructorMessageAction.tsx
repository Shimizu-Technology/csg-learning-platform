import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { conversationPath } from '../../lib/routes'
import { useCohortContext } from '../../contexts/CohortContext'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { Button } from '../ui/Button'

/** Resolve the course's instructor, then open the exact private conversation. */
export function InstructorMessageAction() {
  const { selectedCohortId, selectedCohort } = useCohortContext()
  return (
    <ScopedInstructorAction
      key={selectedCohortId}
      selectedCohortId={selectedCohortId}
      courseName={selectedCohort?.name}
    />
  )
}

function ScopedInstructorAction({
  selectedCohortId,
  courseName,
}: {
  selectedCohortId: number | null
  courseName?: string
}) {
  const preview = useContext(PreviewNavigationContext)
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = String(selectedCohortId)
  const current = useRef(key)
  current.current = key
  useEffect(() => {
    current.current = key
    return () => {
      current.current = ''
    }
  }, [key])
  async function open() {
    if (!selectedCohortId || opening || preview) return
    const openingKey = key
    setOpening(true)
    setError(null)
    try {
      const dashboard = await api.getDashboard(selectedCohortId)
      if (!dashboard.data || dashboard.fromCache) throw new Error('Couldn’t check your course instructor. Try again.')
      if (current.current !== openingKey) return
      const instructorId = dashboard.data.dashboard.support_instructor_id
      if (!instructorId)
        throw new Error(`No instructor is assigned to ${courseName || 'this course'} yet. Contact CSG to arrange help.`)
      const response = await api.createDirectConversation({ cohort_id: selectedCohortId, user_ids: [instructorId] })
      const conversation = response.data?.direct_conversation
      if (!conversation || response.fromCache || conversation.cohort_id !== selectedCohortId)
        throw new Error('Couldn’t open your instructor conversation. Try again.')
      if (current.current !== openingKey) return
      navigate(conversationPath({ type: 'dm', id: conversation.id }, { cohortId: selectedCohortId }))
    } catch (failure) {
      if (current.current === openingKey)
        setError(failure instanceof Error ? failure.message : 'Couldn’t open your instructor conversation. Try again.')
    } finally {
      if (current.current === openingKey) setOpening(false)
    }
  }
  if (preview) return <p className="text-sm text-ink-muted">Messaging is unavailable in View as student.</p>
  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={opening || !selectedCohortId} onClick={() => void open()}>
        {opening ? 'Opening conversation…' : 'Message your instructor'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}

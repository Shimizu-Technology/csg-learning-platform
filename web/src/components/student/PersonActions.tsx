import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, MessageCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { conversationPath } from '../../lib/routes'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { Button, LinkButton } from '../ui/Button'

/** Exact, cohort-scoped conversation. Failure keeps the person and Retry in place. */
function ScopedPersonActions({
  person,
  cohortId,
  meetings = false,
  onOpen,
}: {
  person: { id: number; full_name: string; role?: string }
  cohortId: number
  meetings?: boolean
  onOpen?: () => void
}) {
  const navigate = useNavigate()
  const preview = useContext(PreviewNavigationContext)
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (preview) return
    let active = true
    void api.getAvailableDirectUsersForCohort(cohortId).then(response => {
      if (active) setAllowed(!response.fromCache && Boolean(response.data?.users.some(user => user.id === person.id)))
    }).catch(() => {})
    return () => { active = false }
  }, [cohortId, person.id, preview])
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = `${cohortId}:${person.id}`
  const current = useRef(key)
  current.current = key
  useEffect(() => {
    current.current = key
    return () => {
      current.current = ''
    }
  }, [key])
  async function message() {
    if (!allowed || opening || preview) return
    const openingKey = key
    setOpening(true)
    setError(null)
    try {
      const response = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [person.id] })
      const conversation = response.data?.direct_conversation
      if (!conversation || response.fromCache || conversation.cohort_id !== cohortId)
        throw new Error(`Couldn’t open your conversation with ${person.full_name}. Try again.`)
      if (current.current !== openingKey) return
      navigate(conversationPath({ type: 'dm', id: conversation.id }, { cohortId }))
      onOpen?.()
    } catch (failure) {
      if (current.current === openingKey)
        setError(failure instanceof Error ? failure.message : 'Couldn’t open this conversation. Try again.')
    } finally {
      if (current.current === openingKey) setOpening(false)
    }
  }
  if (preview) return <p className="text-sm text-ink-muted">Messaging is unavailable in View as student.</p>
  if (!allowed) return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void message()} disabled={opening}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {opening ? 'Opening conversation…' : `Message ${person.full_name}`}
        </Button>
        {meetings && person.role === 'instructor' && (
          <LinkButton
            variant="secondary"
            to={`/meetings?cohort_id=${cohortId}&instructor_id=${person.id}`}
            onClick={onOpen}
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Book a meeting
          </LinkButton>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}

export function PersonActions(props: Parameters<typeof ScopedPersonActions>[0]) {
  return <ScopedPersonActions key={`${props.cohortId}:${props.person.id}`} {...props} />
}

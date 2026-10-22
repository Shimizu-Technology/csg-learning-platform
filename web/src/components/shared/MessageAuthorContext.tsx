import { useCallback, useState } from 'react'
import { api } from '../../lib/api'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import type { ChannelMessage } from '../../types/api'
import { StudentContextDrawer } from '../admin/StudentContextDrawer'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Modal } from './Modal'

type Props = { author: ChannelMessage['author']; staff: boolean; cohortId?: number; source?: { type: 'submission' | 'help_request'; id: number; label: string }; onClose: () => void }

export function MessageAuthorContext(props: Props) {
  return <AuthorContext key={`${props.author.id}:${props.cohortId}`} {...props} />
}

function AuthorContext({ author, staff, cohortId, source, onClose }: Props) {
  const learner = staff && author.role === 'student'
  const context = useSection(learner ? String(author.id) : null, useCallback(async () => requireSection(await api.getUser(author.id)), [author.id]))
  const [chosenCohort, setChosenCohort] = useState<number | null>(null)
  const enrollments = context.data?.enrollments || []
  // A cohort conversation is an explicit enrollment context. In a community
  // or group with multiple enrollments, the reader must choose.
  const scoped = enrollments.find((enrollment) => enrollment.cohort_id === cohortId)
  const resolved = chosenCohort ?? scoped?.cohort_id ?? (enrollments.length === 1 ? enrollments[0].cohort_id : null)
  if (learner && resolved) return <StudentContextDrawer open cohortId={resolved} studentId={author.id} source={source} onClose={onClose} />
  return <Modal open onClose={onClose} title={learner ? 'Choose enrollment' : 'Profile'} size="md">
    <div className="mb-4 flex items-center gap-3"><Avatar name={author.full_name} src={author.avatar_url} /><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{author.full_name}</p><p className="text-sm capitalize text-ink-muted">{author.role}</p></div></div>
    {learner && <SectionBoundary section={context} label="Student enrollments">
      {enrollments.length ? <div className="space-y-2"><p className="text-sm text-ink-secondary">Which enrollment would you like to view?</p>{enrollments.map((enrollment) => <Button key={enrollment.id} variant="secondary" fullWidth className="h-auto! min-h-11 justify-start whitespace-normal! text-left" onClick={() => setChosenCohort(enrollment.cohort_id)}>{enrollment.cohort_name} · {enrollment.status}</Button>)}</div> : <p className="text-sm text-ink-muted">No accessible enrollments for this learner.</p>}
    </SectionBoundary>}
  </Modal>
}

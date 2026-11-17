import { useStudentExperience } from '../../lib/studentExperience'
import { useCohortContext } from '../../contexts/CohortContext'
import { PersonActions } from '../student/PersonActions'
import { useCallback, useState } from 'react'
import type { ReturnContext } from '../../lib/navigationContext'
import { api } from '../../lib/api'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import type { MessageView as ChannelMessage } from '../../types/api'
import { StudentContextDrawer } from '../admin/StudentContextDrawer'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Modal } from './Modal'

type Props = { author: ChannelMessage['author']; staff: boolean; cohortId?: number; workspaceReturnContext?: () => ReturnContext | null; source?: { type: 'submission' | 'help_request' | 'intervention'; id: number; label: string }; onClose: () => void }

export function MessageAuthorContext(props: Props) {
  return <AuthorContext key={`${props.author.id}:${props.cohortId}`} {...props} />
}

function AuthorContext({ author, staff, cohortId, workspaceReturnContext, source, onClose }: Props) {
  const { v2 } = useStudentExperience()
  const { selectedCohort } = useCohortContext()
  const learner = staff && author.role === 'student'
  const selfPacedLearner = !staff && selectedCohort?.id === cohortId && selectedCohort?.course_delivery === 'self_paced'
  const contactAvailable = !selfPacedLearner || (selectedCohort?.capabilities?.support_mode === 'course_question' && (selectedCohort.capabilities.features || selectedCohort.features)?.help_requests === true)
  const context = useSection(learner ? String(author.id) : null, useCallback(async () => requireSection(await api.getUser(author.id)), [author.id]))
  const [chosenCohort, setChosenCohort] = useState<number | null>(null)
  const enrollments = context.data?.enrollments || []
  // A cohort conversation is an explicit enrollment context. In a community
  // or group with multiple enrollments, the reader must choose.
  const scoped = enrollments.find((enrollment) => enrollment.cohort_id === cohortId)
  const resolved = chosenCohort ?? scoped?.cohort_id ?? (enrollments.length === 1 ? enrollments[0].cohort_id : null)
  if (learner && resolved) return <StudentContextDrawer open cohortId={resolved} studentId={author.id} source={source} workspaceReturnContext={workspaceReturnContext} onClose={onClose} />
  return <Modal open onClose={onClose} title={learner ? 'Choose enrollment' : 'Profile'} size="md">
    <div className="mb-4 flex items-center gap-3"><Avatar name={author.full_name} src={author.avatar_url} /><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{author.full_name}</p><p className="text-sm capitalize text-ink-muted">{author.role}</p></div></div>
    {v2 && !learner && contactAvailable && cohortId && <PersonActions person={author} cohortId={cohortId} meetings={selectedCohort?.id === cohortId && (selectedCohort.capabilities?.features || selectedCohort.features)?.private_meetings === true} onOpen={onClose} />}
    {learner && <SectionBoundary section={context} label="Student enrollments">
      {enrollments.length ? <div className="space-y-2"><p className="text-sm text-ink-secondary">Which enrollment would you like to view?</p>{enrollments.map((enrollment) => <Button key={enrollment.id} variant="secondary" fullWidth className="h-auto! min-h-11 justify-start whitespace-normal! text-left" onClick={() => setChosenCohort(enrollment.cohort_id)}>{enrollment.cohort_name} · {enrollment.status}</Button>)}</div> : <p className="text-sm text-ink-muted">No accessible enrollments for this learner.</p>}
    </SectionBoundary>}
  </Modal>
}

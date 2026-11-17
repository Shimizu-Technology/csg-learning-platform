import { useConfirm } from '../../contexts/ConfirmContext'
import { useLeaveGuard, leavesPathOrParam } from '../../lib/useLeaveGuard'

/** Leaving preserves the locally saved answer; it never discards a student's work. */
export function SubmissionDraftGuard({ dirty }: { dirty: boolean }) {
  const confirm = useConfirm()
  useLeaveGuard({
    dirty,
    blocks: leavesPathOrParam('cohort_id'),
    confirm: () =>
      confirm({
        title: 'Leave this answer?',
        description: 'Your unsent draft is saved on this device. You can return to finish it.',
        confirmLabel: 'Leave with draft saved',
        cancelLabel: 'Keep editing',
      }),
  })
  return null
}

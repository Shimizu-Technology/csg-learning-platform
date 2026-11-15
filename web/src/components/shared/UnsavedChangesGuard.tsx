import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Button } from '../ui/Button'
import { leavesPath, useLeaveGuard } from '../../lib/useLeaveGuard'

/** The revision changes only when the server supplies a new saved baseline. */
export function useDraftDirty(value: unknown, revision: unknown, enabled = true, savedSerialized?: string) {
  const serialized = JSON.stringify(value)
  const [baseline, setBaseline] = useState({ revision, serialized })
  if (baseline.revision !== revision) setBaseline({ revision, serialized: savedSerialized ?? serialized })
  return enabled && baseline.revision === revision && baseline.serialized !== serialized
}

const always = () => true

/** Asks before any navigation (or, with `pathnameOnly`, any path change) discards a dirty form. */
export function UnsavedChangesGuard({ dirty, pathnameOnly = true, onDiscard }: { dirty: boolean; pathnameOnly?: boolean; onDiscard?: () => void }) {
  const [asking, setAsking] = useState(false)
  const answer = useRef<((leave: boolean) => void) | null>(null)
  const finish = (leave: boolean) => {
    answer.current?.(leave)
    answer.current = null
    setAsking(false)
  }
  useLeaveGuard({
    dirty,
    blocks: pathnameOnly ? leavesPath : always,
    onDiscard,
    confirm: () => new Promise<boolean>((resolve) => {
      answer.current?.(false)
      answer.current = resolve
      setAsking(true)
    }),
  })
  // Saved while the question was open: nothing to discard, so stay.
  useEffect(() => {
    if (!dirty && answer.current) finish(false)
  }, [dirty])
  useEffect(() => () => answer.current?.(false), [])
  return <Modal open={asking} onClose={() => finish(false)} title="Leave without saving?" subtitle="Your unsaved changes will be discarded." footer={<>
    <Button variant="secondary" onClick={() => finish(false)}>Keep editing</Button>
    <Button variant="danger" onClick={() => finish(true)}>Discard changes and leave</Button>
  </>} />
}

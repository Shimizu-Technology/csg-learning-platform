import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { Modal } from './Modal'
import { Button } from '../ui/Button'

/** The revision changes only when the server supplies a new saved baseline. */
export function useDraftDirty(value: unknown, revision: unknown, enabled = true, savedSerialized?: string) {
  const serialized = JSON.stringify(value)
  const [baseline, setBaseline] = useState({ revision, serialized })
  if (baseline.revision !== revision) setBaseline({ revision, serialized: savedSerialized ?? serialized })
  return enabled && baseline.revision === revision && baseline.serialized !== serialized
}

export function UnsavedChangesGuard({ dirty, pathnameOnly = true, onDiscard }: { dirty: boolean; pathnameOnly?: boolean; onDiscard?: () => void }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (!pathnameOnly || currentLocation.pathname !== nextLocation.pathname))
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.reset()
  }, [dirty, blocker])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  return <Modal open={blocker.state === 'blocked'} onClose={() => blocker.state === 'blocked' && blocker.reset()} title="Leave without saving?" subtitle="Your unsaved changes will be discarded." footer={<>
    <Button variant="secondary" onClick={() => blocker.state === 'blocked' && blocker.reset()}>Keep editing</Button>
    <Button variant="danger" onClick={() => blocker.state === 'blocked' && (() => { onDiscard?.(); blocker.proceed() })()}>Discard changes and leave</Button>
  </>} />
}

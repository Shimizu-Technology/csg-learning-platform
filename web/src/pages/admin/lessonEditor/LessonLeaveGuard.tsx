import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../../components/shared/Modal'
import { Button } from '../../../components/ui/Button'
import { leavesPath, useLeaveGuard } from '../../../lib/useLeaveGuard'

/**
 * The lesson editor's leave question (mockup 03): Keep editing, Discard, or
 * Save and leave. Registers with the router's one blocker (#251), so links,
 * Back, browser navigation and closing the tab are all covered.
 */
export function LessonLeaveGuard({ dirty, onSave, problem }: {
  dirty: boolean
  /** Saves now; resolves true when everything saved. */
  onSave: () => Promise<boolean>
  /** Why the lesson can't save yet (shown instead of Save and leave). */
  problem?: string | null
}) {
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const answer = useRef<((leave: boolean) => void) | null>(null)
  const finish = (leave: boolean) => {
    answer.current?.(leave)
    answer.current = null
    setAsking(false)
    setSaving(false)
  }
  useLeaveGuard({
    dirty,
    blocks: leavesPath,
    confirm: () => new Promise<boolean>((resolve) => {
      answer.current?.(false)
      answer.current = resolve
      setSaveError(null)
      setAsking(true)
    }),
  })
  useEffect(() => () => answer.current?.(false), [])

  const saveAndLeave = async () => {
    setSaving(true)
    setSaveError(null)
    const saved = await onSave()
    if (saved) {
      finish(true)
    } else {
      setSaving(false)
      setSaveError('The lesson didn\'t save, so you\'re still here. Check the message at the top of the editor.')
    }
  }

  return (
    <Modal
      open={asking}
      onClose={() => finish(false)}
      size="md"
      title="Leave without saving?"
      subtitle="You changed this lesson in the last few seconds and those edits haven't saved yet."
      footer={(
        <>
          <Button variant="quiet" onClick={() => finish(false)} disabled={saving}>Keep editing</Button>
          <Button variant="secondary" onClick={() => finish(true)} disabled={saving}>Discard</Button>
          {!problem && <Button onClick={() => void saveAndLeave()} disabled={saving}>{saving ? 'Saving…' : 'Save and leave'}</Button>}
        </>
      )}
    >
      {problem && <p className="text-sm text-ink-secondary">This lesson can't save yet: {problem}</p>}
      {saveError && <p role="alert" className="mt-2 text-sm text-danger-ink">{saveError}</p>}
    </Modal>
  )
}

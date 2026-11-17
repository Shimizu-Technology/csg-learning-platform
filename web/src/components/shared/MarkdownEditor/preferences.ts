import { useCallback, useEffect, useState } from 'react'
import { useAuthContext } from '../../../contexts/AuthContext'
import { EDITOR_PREFERENCES_CHANGE_EVENT, readEditorPreferences, writeEditorPreferences, type EditorMode, type EditorPreferencesChange } from '../../../lib/editorPreferences'

export {
  applyServerEditorPreferences,
  DEFAULT_EDITOR_PREFERENCES,
  editorPreferencesKey,
  readEditorPreferences,
  writeEditorPreferences,
  type EditorMode,
  type EditorPreferences,
} from '../../../lib/editorPreferences'

/**
 * The remembered mode, read once when an editor mounts: switching one editor
 * remembers the choice for the next editor that opens but doesn't flip
 * editors already open on the page.
 */
export function useInitialEditorMode(): [EditorMode, (mode: EditorMode) => void] {
  const { user } = useAuthContext()
  const userId = user?.id
  const [mode] = useState<EditorMode>(() => readEditorPreferences(userId).mode)
  const remember = useCallback((next: EditorMode) => { writeEditorPreferences(userId, { mode: next }) }, [userId])
  return [mode, remember]
}

/** Enter-to-send, live: changing it in one composer's help applies to every composer at once. */
export function useEnterToSend(): [boolean, (enterSends: boolean) => void] {
  const { user } = useAuthContext()
  const userId = user?.id
  const [enterSends, setEnterSends] = useState(() => readEditorPreferences(userId).enterSends)

  useEffect(() => {
    setEnterSends(readEditorPreferences(userId).enterSends)
    // This window's change carries the new value: use it, so a choice storage refused still applies.
    const syncChange = (event: Event) => {
      const detail = (event as CustomEvent<EditorPreferencesChange | undefined>).detail
      if (detail && detail.userId === (userId ?? null)) setEnterSends(detail.preferences.enterSends)
    }
    // Another tab's change is only in storage.
    const sync = () => setEnterSends(readEditorPreferences(userId).enterSends)
    window.addEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, syncChange)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, syncChange)
      window.removeEventListener('storage', sync)
    }
  }, [userId])

  const update = useCallback((next: boolean) => {
    setEnterSends(next)
    writeEditorPreferences(userId, { enterSends: next })
  }, [userId])
  return [enterSends, update]
}

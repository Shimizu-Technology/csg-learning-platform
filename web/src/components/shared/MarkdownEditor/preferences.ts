import { useCallback, useEffect, useState } from 'react'
import { useAuthContext } from '../../../contexts/AuthContext'

/**
 * Per-person editor preferences (design spec §9.1, §9.7): the editing mode
 * every editor opens in, and whether Enter sends in the message composer.
 *
 * Stored in this browser's local storage, per signed-in user, so a shared
 * lab computer keeps each learner's choice. A profile setting that follows
 * the person across devices is a follow-up (needs an API field).
 */
export type EditorMode = 'rich' | 'markdown'

export type EditorPreferences = { mode: EditorMode; enterSends: boolean }

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { mode: 'rich', enterSends: true }

const CHANGE_EVENT = 'csg-editor-preferences'

export function editorPreferencesKey(userId: number | null | undefined) {
  return `csg-editor-preferences:${userId ?? 'signed-out'}`
}

/** Choices this page couldn't store (private windows, full storage): they still apply until reload. */
const unsaved = new Map<string, EditorPreferences>()

type ChangeDetail = { userId: number | null; preferences: EditorPreferences }

export function readEditorPreferences(userId: number | null | undefined): EditorPreferences {
  const pending = unsaved.get(editorPreferencesKey(userId))
  if (pending) return pending
  try {
    const parsed = JSON.parse(window.localStorage.getItem(editorPreferencesKey(userId)) || '{}') as Partial<EditorPreferences>
    return {
      mode: parsed.mode === 'markdown' ? 'markdown' : 'rich',
      enterSends: parsed.enterSends !== false,
    }
  } catch {
    return DEFAULT_EDITOR_PREFERENCES
  }
}

export function writeEditorPreferences(userId: number | null | undefined, change: Partial<EditorPreferences>) {
  const next = { ...readEditorPreferences(userId), ...change }
  const key = editorPreferencesKey(userId)
  try {
    window.localStorage.setItem(key, JSON.stringify(next))
    unsaved.delete(key)
  } catch {
    // Storage can be unavailable (private windows). The choice still applies until reload.
    unsaved.set(key, next)
  }
  try {
    window.dispatchEvent(new CustomEvent<ChangeDetail>(CHANGE_EVENT, { detail: { userId: userId ?? null, preferences: next } }))
  } catch {
    // Older browsers without CustomEvent constructors: other editors pick it up on their next mount.
  }
  return next
}

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
      const detail = (event as CustomEvent<ChangeDetail | undefined>).detail
      if (detail && detail.userId === (userId ?? null)) setEnterSends(detail.preferences.enterSends)
    }
    // Another tab's change is only in storage.
    const sync = () => setEnterSends(readEditorPreferences(userId).enterSends)
    window.addEventListener(CHANGE_EVENT, syncChange)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, syncChange)
      window.removeEventListener('storage', sync)
    }
  }, [userId])

  const update = useCallback((next: boolean) => {
    setEnterSends(next)
    writeEditorPreferences(userId, { enterSends: next })
  }, [userId])
  return [enterSends, update]
}

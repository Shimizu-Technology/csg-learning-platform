import { api } from './api'
import type { EditorPreferences as ServerEditorPreferences } from '../types/api'

/**
 * Per-person editor preferences (design spec §9.1, §9.7): the editing mode
 * every editor opens in, and whether Enter sends in the message composer.
 *
 * Saved on the account (U-6.8), so they follow the person across browsers
 * and devices. This browser keeps a copy per signed-in user, which editors
 * read when they open: the session's values are written into it at sign-in
 * (`applyServerEditorPreferences`), and a choice made here is kept here and
 * marked pending until the server has it, so a failed save is sent again at
 * the next sign-in instead of being lost.
 */
export type EditorMode = 'rich' | 'markdown'

export type EditorPreferences = { mode: EditorMode; enterSends: boolean }

type PreferenceField = keyof EditorPreferences

/** This browser's copy: only what was chosen or received, and which choices the server doesn't have yet. */
type StoredPreferences = Partial<EditorPreferences> & { pending?: PreferenceField[] }

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { mode: 'rich', enterSends: true }

export const EDITOR_PREFERENCES_CHANGE_EVENT = 'csg-editor-preferences'
const FIELDS: PreferenceField[] = ['mode', 'enterSends']

export function editorPreferencesKey(userId: number | null | undefined) {
  return `csg-editor-preferences:${userId ?? 'signed-out'}`
}

/** Choices this page couldn't store (private windows, full storage): they still apply until reload. */
const unsaved = new Map<string, StoredPreferences>()

export type EditorPreferencesChange = { userId: number | null; preferences: EditorPreferences }

function readStored(userId: number | null | undefined): StoredPreferences {
  const pending = unsaved.get(editorPreferencesKey(userId))
  if (pending) return pending
  try {
    const parsed = JSON.parse(window.localStorage.getItem(editorPreferencesKey(userId)) || '{}') as Record<string, unknown>
    const stored: StoredPreferences = {}
    if (parsed.mode === 'rich' || parsed.mode === 'markdown') stored.mode = parsed.mode
    if (typeof parsed.enterSends === 'boolean') stored.enterSends = parsed.enterSends
    if (Array.isArray(parsed.pending)) stored.pending = FIELDS.filter((field) => (parsed.pending as unknown[]).includes(field))
    return stored
  } catch {
    return {}
  }
}

function writeStored(userId: number | null | undefined, stored: StoredPreferences) {
  const key = editorPreferencesKey(userId)
  const value = { ...stored, ...(stored.pending?.length ? {} : { pending: undefined }) }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    unsaved.delete(key)
  } catch {
    // Storage can be unavailable (private windows). The choice still applies until reload.
    unsaved.set(key, value)
  }
}

function resolved(stored: StoredPreferences): EditorPreferences {
  return { mode: stored.mode ?? DEFAULT_EDITOR_PREFERENCES.mode, enterSends: stored.enterSends ?? DEFAULT_EDITOR_PREFERENCES.enterSends }
}

function announceChange(userId: number | null | undefined, preferences: EditorPreferences) {
  try {
    window.dispatchEvent(new CustomEvent<EditorPreferencesChange>(EDITOR_PREFERENCES_CHANGE_EVENT, { detail: { userId: userId ?? null, preferences } }))
  } catch {
    // Older browsers without CustomEvent constructors: other editors pick it up on their next mount.
  }
}

/** Sends choices to the account; each one stops being pending once the server has that same value. */
function upload(userId: number, values: Partial<EditorPreferences>) {
  const body = { ...(values.mode ? { mode: values.mode } : {}), ...(values.enterSends !== undefined ? { enter_sends: values.enterSends } : {}) }
  if (Object.keys(body).length === 0) return
  let request: ReturnType<typeof api.updateEditorPreferences>
  try {
    request = api.updateEditorPreferences(body)
  } catch {
    return
  }
  Promise.resolve(request).then((response) => {
    const saved = response?.data?.editor_preferences
    if (!saved) return
    const stored = readStored(userId)
    const done = FIELDS.filter((field) => (field === 'mode' ? saved.mode : saved.enter_sends) === stored[field])
    if (!stored.pending?.some((field) => done.includes(field))) return
    writeStored(userId, { ...stored, pending: stored.pending.filter((field) => !done.includes(field)) })
  }).catch(() => {
    // Offline or refused: the choice stays pending and is sent again at the next sign-in.
  })
}

export function readEditorPreferences(userId: number | null | undefined): EditorPreferences {
  return resolved(readStored(userId))
}

export function writeEditorPreferences(userId: number | null | undefined, change: Partial<EditorPreferences>) {
  const stored = readStored(userId)
  const changed = FIELDS.filter((field) => change[field] !== undefined)
  const next: StoredPreferences = { ...stored, ...change, pending: [...new Set([...(stored.pending || []), ...(userId ? changed : [])])] }
  writeStored(userId, next)
  const preferences = resolved(next)
  announceChange(userId, preferences)
  if (userId) upload(userId, change)
  return preferences
}

/**
 * At sign-in: the account's preferences become this browser's, except a
 * choice made here that the server doesn't have yet. That one, and any
 * choice this browser remembered from before preferences were saved on the
 * account (the server has none yet), is sent up instead.
 */
export function applyServerEditorPreferences(userId: number, server: ServerEditorPreferences | null | undefined) {
  const stored = readStored(userId)
  const next: StoredPreferences = { ...stored }
  const toUpload: Partial<EditorPreferences> = {}
  const fromServer = { mode: server?.mode ?? null, enterSends: server?.enter_sends ?? null }
  for (const field of FIELDS) {
    const local = stored[field]
    const remote = fromServer[field]
    if (local !== undefined && (stored.pending?.includes(field) || remote === null)) {
      Object.assign(toUpload, { [field]: local })
    } else if (remote !== null) {
      Object.assign(next, { [field]: remote })
    }
  }
  next.pending = FIELDS.filter((field) => field in toUpload)
  const before = resolved(stored)
  const after = resolved(next)
  writeStored(userId, next)
  if (before.mode !== after.mode || before.enterSends !== after.enterSends) announceChange(userId, after)
  upload(userId, toUpload)
}

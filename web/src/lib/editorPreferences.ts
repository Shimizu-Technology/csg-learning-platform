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
 * the next sign-in instead of being lost. Saves from one tab run in order.
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

type AccountValues = ServerEditorPreferences

const accountValue = (saved: AccountValues, field: PreferenceField) => (field === 'mode' ? saved.mode : saved.enter_sends)

function requestBody(values: Partial<EditorPreferences>) {
  return { ...(values.mode ? { mode: values.mode } : {}), ...(values.enterSends !== undefined ? { enter_sends: values.enterSends } : {}) }
}

/**
 * Saves run one at a time in this tab, so a slow answer can never land after
 * a newer choice and leave the account on the older one. Offline or refused
 * saves leave their choices pending, to be sent again at the next sign-in.
 */
let saves: Promise<void> = Promise.resolve()

function queueSave(job: () => Promise<void>) {
  saves = saves.then(job).catch(() => undefined)
}

/**
 * Sends this browser's pending choices as they are when the save runs (so a
 * burst of changes sends only the latest). A choice stops being pending only
 * when the account answers with the value this browser still holds; one
 * changed meanwhile stays pending for the save queued after it.
 */
function savePending(userId: number) {
  queueSave(async () => {
    const stored = readStored(userId)
    const body = requestBody(Object.fromEntries((stored.pending || []).map((field) => [field, stored[field]])))
    if (Object.keys(body).length === 0) return
    const saved = (await api.updateEditorPreferences(body))?.data?.editor_preferences
    if (!saved) return
    const latest = readStored(userId)
    const done = FIELDS.filter((field) => latest.pending?.includes(field) && accountValue(saved, field) === latest[field])
    if (done.length) writeStored(userId, { ...latest, pending: latest.pending!.filter((field) => !done.includes(field)) })
  })
}

/**
 * Uploads a choice this browser remembered from before preferences were on
 * the account. The server sets each field only if the account still has none
 * (another device may have chosen since), and this browser then takes
 * whatever the account has.
 */
function initializeAccount(userId: number, values: Partial<EditorPreferences>) {
  const body = requestBody(values)
  if (Object.keys(body).length === 0) return
  queueSave(async () => {
    const saved = (await api.updateEditorPreferences({ ...body, initialize: true }))?.data?.editor_preferences
    if (!saved) return
    const latest = readStored(userId)
    const next: StoredPreferences = { ...latest }
    for (const field of FIELDS) {
      const value = accountValue(saved, field)
      // A choice made here since stays: it's pending and will be saved after this.
      if (field in values && value !== null && !latest.pending?.includes(field)) Object.assign(next, { [field]: value })
    }
    const before = resolved(latest)
    const after = resolved(next)
    writeStored(userId, next)
    if (before.mode !== after.mode || before.enterSends !== after.enterSends) announceChange(userId, after)
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
  if (userId) savePending(userId)
  return preferences
}

/**
 * At sign-in: the account's preferences become this browser's, except a
 * choice made here that the server doesn't have yet, which is sent up. A
 * choice this browser remembered from before preferences were on the account
 * (the account has none yet) is offered once with `initialize`, which never
 * overwrites a choice another device made in the meantime.
 */
export function applyServerEditorPreferences(userId: number, server: ServerEditorPreferences | null | undefined) {
  const stored = readStored(userId)
  const next: StoredPreferences = { ...stored }
  const legacy: Partial<EditorPreferences> = {}
  const fromServer = { mode: server?.mode ?? null, enterSends: server?.enter_sends ?? null }
  for (const field of FIELDS) {
    const local = stored[field]
    const remote = fromServer[field]
    if (local !== undefined && stored.pending?.includes(field)) continue
    if (local !== undefined && remote === null) Object.assign(legacy, { [field]: local })
    else if (remote !== null) Object.assign(next, { [field]: remote })
  }
  next.pending = FIELDS.filter((field) => stored.pending?.includes(field) && stored[field] !== undefined)
  const before = resolved(stored)
  const after = resolved(next)
  writeStored(userId, next)
  if (before.mode !== after.mode || before.enterSends !== after.enterSends) announceChange(userId, after)
  initializeAccount(userId, legacy)
  if (next.pending.length) savePending(userId)
}

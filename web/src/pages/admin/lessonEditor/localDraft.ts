import type { LessonDraft } from './blockDraft'

/*
 * A crash backup of unsaved lesson edits, in this browser only. It is never
 * sent anywhere on its own: restoring puts it back in the editor, and the
 * person still chooses Save. Storage can be missing or full (private windows,
 * blocked site data), so every access is guarded and failure just means no
 * backup.
 */

export interface LocalDraftBackup {
  savedAt: number
  /** The lesson version the edits started from; a backup only restores onto that version. */
  baseUpdatedAt: string
  draft: LessonDraft
}

export const localDraftKey = (userId: number | string, lessonId: number) => `csg:lesson-editor-draft:v1:${userId}:${lessonId}`

export function readLocalDraft(key: string): LocalDraftBackup | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalDraftBackup>
    if (typeof parsed.savedAt !== 'number' || typeof parsed.baseUpdatedAt !== 'string' || !parsed.draft || !Array.isArray(parsed.draft.blocks) ||
      !Array.isArray(parsed.draft.removed_block_ids) || !Array.isArray(parsed.draft.alignments)) return null
    return parsed as LocalDraftBackup
  } catch {
    return null
  }
}

export function writeLocalDraft(key: string, backup: LocalDraftBackup) {
  try {
    window.localStorage.setItem(key, JSON.stringify(backup))
  } catch {
    // No backup this time; the editor still works.
  }
}

export function clearLocalDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

import { BLOCK_LABELS, type LessonDraft } from './blockDraft'

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

const KEY_PREFIX = 'csg:lesson-editor-draft:v1:'

export const localDraftKey = (userId: number | string, lessonId: number) => `${KEY_PREFIX}${userId}:${lessonId}`

/*
 * Bumped whenever a viewer's backups are cleared (sign-out, account change).
 * A backup write scheduled before that carries the old generation and is
 * dropped, so a pending timer can't put the departing viewer's edits back.
 */
let generation = 0

export const localDraftGeneration = () => generation

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

export function writeLocalDraft(key: string, backup: LocalDraftBackup, scheduledIn = generation) {
  if (scheduledIn !== generation) return
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

/**
 * Removes a viewer's lesson backups from this browser when they sign out or
 * another account takes over, and cancels backups still waiting to be
 * written. With no known viewer (signed out before the session loaded),
 * every lesson backup goes.
 */
export function clearViewerLocalDrafts(userId: number | null, storage?: Pick<Storage, 'length' | 'key' | 'removeItem'> | null) {
  generation += 1
  try {
    const target = storage ?? window.localStorage
    const prefix = userId == null ? KEY_PREFIX : `${KEY_PREFIX}${userId}:`
    const keys: string[] = []
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    keys.forEach((key) => target.removeItem(key))
  } catch {
    // Storage is unavailable, so there's nothing stored to clear.
  }
}

/**
 * A backup as plain text, so someone who can't save it here (editing access
 * turned off, or the curriculum now shared) can copy it somewhere safe.
 */
export function localDraftText(backup: LocalDraftBackup): string {
  const { draft } = backup
  const parts = [`Lesson: ${draft.title.trim() || 'Untitled lesson'}`]
  draft.blocks.forEach((block, index) => {
    const lines = [`${index + 1}. ${BLOCK_LABELS[block.block_type] ?? block.block_type}${block.title.trim() ? `: ${block.title.trim()}` : ''}`]
    if (block.body.trim()) lines.push(block.body.trim())
    if (block.video_url.trim()) lines.push(`Video: ${block.video_url.trim()}`)
    if (block.solution.trim()) lines.push(`Solution${block.filename.trim() ? ` (${block.filename.trim()})` : ''}:`, block.solution.trim())
    if (block.check) {
      lines.push(`Retrieval check: ${block.check.prompt.trim()}`)
      block.check.options.forEach((option, optionIndex) => lines.push(`${optionIndex === block.check!.correct_option ? '*' : '-'} ${option}`))
      if (block.check.explanation.trim()) lines.push(`Explanation: ${block.check.explanation.trim()}`)
    }
    parts.push(lines.join('\n'))
  })
  return parts.join('\n\n') + '\n'
}

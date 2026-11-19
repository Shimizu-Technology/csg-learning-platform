import type { ContentBlockSummary, LessonBlockEditorInput, LessonBlockInput, LessonDetail } from '../../../types/api'
import { normalizeVideoSegments, type VideoSegment } from '../../../lib/videoSegments'

/*
 * The block lesson editor's draft: every block in order, plus the lesson
 * settings saved with them. Pure functions, so ordering, duplication and the
 * save payload are tested without rendering the page.
 */

export const MAX_BLOCKS = 20

export type BlockType = 'text' | 'video' | 'recording' | 'exercise' | 'code_challenge' | 'checkpoint'

/** The types the add menu offers. Recordings are added as Video blocks and switched in the block. */
export const ADDABLE_BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'video', label: 'Video or recording' },
  { type: 'exercise', label: 'Exercise' },
  { type: 'code_challenge', label: 'Code challenge' },
  { type: 'checkpoint', label: 'Checkpoint' },
]

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Text',
  video: 'Video',
  recording: 'Recording',
  exercise: 'Exercise',
  code_challenge: 'Code challenge',
  checkpoint: 'Checkpoint',
}

export interface CheckDraft {
  prompt: string
  options: string[]
  correct_option: number
  explanation: string
  learning_objective_id: number | null
}

export interface BlockDraft {
  /** Stable React key; never changes for a block while the page is open, even after its first save gives it an id. */
  key: string
  id: number | null
  block_type: BlockType
  title: string
  body: string
  solution: string
  filename: string
  video_url: string
  s3_video_key: string | null
  s3_video_content_type: string | null
  s3_video_size: number | null
  s3_video_duration_seconds?: number | null
  /** The block's own submission type; null falls back to the lesson's legacy rule. */
  submission_type: string | null
  submission_config: Record<string, unknown>
  rubric_id: number | null
  video_segments: VideoSegment[]
  /** Carried into duplicates (language, imported ids). Existing blocks keep theirs on the server. */
  metadata: Record<string, unknown>
  check: CheckDraft | null
  /** Students have answered this block's retrieval check, so it can't change. */
  check_locked: boolean
}

export interface AlignmentDraft {
  learning_objective_id: number
  /** The block it applies to (by draft key), or null for the whole lesson. */
  block_key: string | null
}

export interface LessonDraft {
  title: string
  required: boolean
  release_day: number
  blocks: BlockDraft[]
  /** Saved blocks deleted in this draft. */
  removed_block_ids: number[]
  alignments: AlignmentDraft[]
}

let nextKey = 0
export function newKey() {
  nextKey += 1
  return `new-${nextKey}`
}

export const savedKey = (id: number) => `b${id}`

function isBlockType(value: string): value is BlockType {
  return value in BLOCK_LABELS
}

/** Metadata a duplicate keeps (language, imported ids); video sections travel in `video_segments`. */
function carriedMetadata(metadata: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(Object.entries(metadata || {}).filter(([key]) => !key.startsWith('video_segments')))
}

export function blockFromServer(block: ContentBlockSummary, key = savedKey(block.id)): BlockDraft {
  const check = block.knowledge_check
  return {
    key,
    id: block.id,
    block_type: isBlockType(block.block_type) ? block.block_type : 'text',
    title: block.title || '',
    body: block.body || '',
    solution: block.solution || '',
    filename: block.filename || '',
    video_url: block.video_url || '',
    s3_video_key: block.s3_video_key || null,
    s3_video_content_type: block.s3_video_content_type || null,
    s3_video_size: block.s3_video_size ?? null,
    s3_video_duration_seconds: block.s3_video_duration_seconds ?? null,
    submission_type: block.submission_type_explicit || null,
    submission_config: (block.submission_config || {}) as Record<string, unknown>,
    rubric_id: block.rubric?.id ?? null,
    video_segments: normalizeVideoSegments(block.metadata),
    metadata: carriedMetadata(block.metadata),
    check: check ? {
      prompt: check.prompt,
      options: [...check.options],
      correct_option: check.correct_option ?? 0,
      explanation: check.explanation || '',
      learning_objective_id: check.learning_objective_id ?? null,
    } : null,
    check_locked: Boolean(check && check.attempt_count > 0),
  }
}

/** A draft from the server's lesson. `keys` keeps the keys of blocks already on the page. */
export function draftFromLesson(lesson: LessonDetail, keys: Map<number, string> = new Map()): LessonDraft {
  const blocks = [...lesson.content_blocks].sort((a, b) => a.position - b.position)
  return {
    title: lesson.title,
    required: lesson.required !== false,
    release_day: lesson.release_day,
    blocks: blocks.map((block) => blockFromServer(block, keys.get(block.id))),
    removed_block_ids: [],
    alignments: (lesson.objectives || []).map((objective) => ({
      learning_objective_id: objective.id,
      block_key: objective.content_block_id ? keys.get(objective.content_block_id) || savedKey(objective.content_block_id) : null,
    })),
  }
}

export function newBlock(type: BlockType): BlockDraft {
  return {
    key: newKey(),
    id: null,
    block_type: type,
    title: '',
    body: '',
    solution: '',
    filename: '',
    video_url: '',
    s3_video_key: null,
    s3_video_content_type: null,
    s3_video_size: null,
    submission_type: type === 'exercise' || type === 'code_challenge' ? 'manual_complete' : null,
    submission_config: {},
    rubric_id: null,
    video_segments: [],
    metadata: {},
    check: null,
    check_locked: false,
  }
}

export function emptyCheck(): CheckDraft {
  return { prompt: '', options: ['', ''], correct_option: 0, explanation: '', learning_objective_id: null }
}

/** A copy saved as a new block: same content, its own retrieval check, no learner work. */
export function duplicateBlock(block: BlockDraft): BlockDraft {
  return {
    ...structuredClone(block),
    key: newKey(),
    id: null,
    check_locked: false,
  }
}

export function insertBlock(blocks: BlockDraft[], index: number, block: BlockDraft) {
  const next = [...blocks]
  next.splice(Math.max(0, Math.min(index, next.length)), 0, block)
  return next
}

export function moveBlock(blocks: BlockDraft[], from: number, to: number) {
  if (from === to || from < 0 || from >= blocks.length) return blocks
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

export function removeBlock(draft: LessonDraft, key: string): LessonDraft {
  const block = draft.blocks.find((item) => item.key === key)
  if (!block) return draft
  return {
    ...draft,
    blocks: draft.blocks.filter((item) => item.key !== key),
    removed_block_ids: block.id ? [...draft.removed_block_ids, block.id] : draft.removed_block_ids,
    alignments: draft.alignments.map((alignment) => alignment.block_key === key ? { ...alignment, block_key: null } : alignment),
  }
}

export function blockTitle(block: Pick<BlockDraft, 'block_type' | 'title'>) {
  return block.title.trim() || BLOCK_LABELS[block.block_type]
}

/** What stops a block from saving, in words for the person editing it. */
export function blockProblem(block: BlockDraft): string | null {
  if (block.block_type === 'checkpoint' && block.check && !block.check_locked) {
    const options = block.check.options.map((option) => option.trim())
    if (!block.check.prompt.trim()) return 'Add the question, or remove it to make this a plain checkpoint.'
    if (options.length < 2 || options.some((option) => !option)) return 'Fill in every choice (two to six).'
    if (block.check.correct_option >= options.length) return 'Pick the correct choice.'
    if (!block.check.explanation.trim()) return 'Add the explanation students see after answering.'
  }
  return null
}

export function draftProblems(draft: LessonDraft) {
  const problems = new Map<string, string>()
  draft.blocks.forEach((block) => {
    const problem = blockProblem(block)
    if (problem) problems.set(block.key, problem)
  })
  return problems
}

const nullable = (value: string) => (value.trim() ? value : null)

/**
 * The PUT body. `baseline` is the last saved version of each block, so
 * unchanged videos and segments aren't re-sent; `pendingUploads` are blocks
 * whose new upload hasn't finished (their old video stays until it has).
 */
export function draftPayload(
  draft: LessonDraft,
  options: { baseUpdatedAt: string; baseline: Map<number, BlockDraft>; pendingUploads?: Set<number>; confirmWatchReset?: number[] },
): LessonBlockEditorInput['lesson'] {
  const blocks: LessonBlockInput[] = draft.blocks.map((block) => {
    const saved = block.id ? options.baseline.get(block.id) : undefined
    const payload: LessonBlockInput = {
      ...(block.id ? { id: block.id } : { client_id: block.key, metadata: block.metadata }),
      ...(JSON.stringify(block.metadata.video_versions) !== JSON.stringify(saved?.metadata.video_versions) ||
        block.metadata.video_versions_duration_seconds !== saved?.metadata.video_versions_duration_seconds
        ? { metadata: { ...block.metadata } } : {}),
      block_type: block.block_type,
      title: nullable(block.title),
      body: nullable(block.body),
      solution: nullable(block.solution),
      filename: nullable(block.filename),
      video_url: nullable(block.video_url.trim()),
      submission_type: block.submission_type as LessonBlockInput['submission_type'],
      submission_config: block.submission_config,
      rubric_id: block.rubric_id,
      knowledge_check: block.block_type === 'checkpoint' && block.check ? {
        prompt: block.check.prompt.trim(),
        options: block.check.options.map((option) => option.trim()),
        correct_option: block.check.correct_option,
        explanation: block.check.explanation.trim(),
        learning_objective_id: block.check.learning_objective_id,
      } : null,
    }
    const uploadPending = block.id !== null && options.pendingUploads?.has(block.id)
    if (!uploadPending && (block.s3_video_key || null) !== (saved?.s3_video_key || null)) {
      payload.s3_video_key = block.s3_video_key
      payload.s3_video_content_type = block.s3_video_content_type
      payload.s3_video_size = block.s3_video_size
    }
    if ((block.block_type === 'video' || block.block_type === 'recording') &&
      JSON.stringify(block.video_segments) !== JSON.stringify(saved?.video_segments || [])) {
      payload.video_segments = block.video_segments
    }
    return payload
  })
  return {
    base_updated_at: options.baseUpdatedAt,
    title: draft.title.trim() || 'Untitled lesson',
    required: draft.required,
    release_day: draft.release_day,
    blocks,
    removed_block_ids: draft.removed_block_ids,
    ...(options.confirmWatchReset?.length ? { confirm_watch_reset_block_ids: options.confirmWatchReset } : {}),
    alignments: draft.alignments.map((alignment) => {
      const block = alignment.block_key ? draft.blocks.find((item) => item.key === alignment.block_key) : null
      if (!block) return { learning_objective_id: alignment.learning_objective_id, content_block_id: null }
      return block.id
        ? { learning_objective_id: alignment.learning_objective_id, content_block_id: block.id }
        : { learning_objective_id: alignment.learning_objective_id, block_client_id: block.key }
    }),
  }
}

/**
 * After a save: give the blocks created by it their new ids (matched by
 * position in what was sent) and forget the removals that went through.
 * A new block deleted while its first save was in flight now exists on the
 * server, so its id is queued for removal; otherwise the next save wouldn't
 * account for it.
 */
export function applySavedIds(draft: LessonDraft, sent: LessonDraft, saved: LessonDetail): LessonDraft {
  const savedBlocks = [...saved.content_blocks].sort((a, b) => a.position - b.position)
  const idsByKey = new Map<string, number>()
  sent.blocks.forEach((block, index) => {
    const match = savedBlocks[index]
    if (match && block.id === null) idsByKey.set(block.key, match.id)
  })
  const removed = new Set(sent.removed_block_ids)
  const current = new Set(draft.blocks.map((block) => block.key))
  const createdThenDeleted = [...idsByKey].filter(([key]) => !current.has(key)).map(([, id]) => id)
  return {
    ...draft,
    blocks: draft.blocks.map((block) => block.id === null && idsByKey.has(block.key) ? { ...block, id: idsByKey.get(block.key)! } : block),
    removed_block_ids: [...draft.removed_block_ids.filter((id) => !removed.has(id)), ...createdThenDeleted.filter((id) => !draft.removed_block_ids.includes(id))],
  }
}

/** Gives unsaved blocks fresh keys (a restored backup's keys may repeat ones this page hands out). */
export function rekeyNewBlocks(draft: LessonDraft): LessonDraft {
  const keys = new Map<string, string>()
  const blocks = draft.blocks.map((block) => {
    if (block.id !== null) return block
    const key = newKey()
    keys.set(block.key, key)
    return { ...block, key }
  })
  return {
    ...draft,
    blocks,
    alignments: draft.alignments.map((alignment) => alignment.block_key && keys.has(alignment.block_key) ? { ...alignment, block_key: keys.get(alignment.block_key)! } : alignment),
  }
}

/** The saved version of each block, by id, for the next payload's comparisons. */
export function baselineFor(draft: LessonDraft) {
  return new Map(draft.blocks.filter((block) => block.id !== null).map((block) => [block.id!, block]))
}

/** Stable text for comparing drafts (dirty state). Keys are left out: they never reach the server. */
export function draftSignature(draft: LessonDraft) {
  return JSON.stringify({
    ...draft,
    blocks: draft.blocks.map((block) => ({ ...block, key: undefined })),
    alignments: draft.alignments.map((alignment) => ({
      learning_objective_id: alignment.learning_objective_id,
      block: alignment.block_key ? draft.blocks.findIndex((block) => block.key === alignment.block_key) : null,
    })),
  })
}

/** A block as the lesson page renders it, for Preview. */
export function previewBlock(block: BlockDraft, index: number, objectiveCode: (id: number | null) => string | null) {
  return {
    id: block.id ?? -(index + 1),
    block_type: block.block_type,
    position: index,
    title: block.title.trim() || null,
    body: block.body.trim() || null,
    video_url: block.video_url.trim() || null,
    filename: block.filename.trim() || null,
    submission_type: block.submission_type,
    effective_submission_type: block.submission_type,
    submission_config: block.submission_config,
    solution: null,
    metadata: { ...block.metadata, video_segments: block.video_segments },
    s3_video_key: block.s3_video_key,
    knowledge_check: block.block_type === 'checkpoint' && block.check?.prompt.trim() ? {
      id: block.id ?? -(index + 1),
      prompt: block.check.prompt.trim(),
      options: block.check.options.map((option) => option.trim()),
      correct_option: block.check.correct_option,
      explanation: block.check.explanation.trim(),
      learning_objective_id: block.check.learning_objective_id,
      objective_code: objectiveCode(block.check.learning_objective_id),
      attempt_count: 0,
      latest_attempt: null,
    } : null,
  }
}

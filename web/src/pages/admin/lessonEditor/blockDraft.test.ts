import { describe, expect, it } from 'vitest'
import type { LessonDetail } from '../../../types/api'
import {
  applySavedIds, baselineFor, blockProblem, draftFromLesson, draftPayload, draftSignature, duplicateBlock, emptyCheck, insertBlock, moveBlock,
  newBlock, rekeyNewBlocks, removeBlock,
} from './blockDraft'

const block = (id: number, block_type: string, extra: Record<string, unknown> = {}) => ({
  id, block_type, position: id, title: `Block ${id}`, body: null, video_url: null, filename: null, submission_type: null,
  effective_submission_type: null, submission_type_explicit: null, submission_config: {}, metadata: {}, s3_video_key: null,
  objective_ids: [], rubric: null, knowledge_check: null, has_s3_video: false, completion_required: false, ...extra,
})

const lesson = {
  id: 9, curriculum_id: 1, module_id: 2, title: 'Make decisions', lesson_type: 'exercise', position: 0, release_day: 0, required: true,
  requires_submission: false, submission_type: 'manual_complete', content_blocks_count: 3, archived_at: null, updated_at: '2026-11-16T00:00:00.000000Z',
  objectives: [{ alignment_id: 1, id: 5, code: 'JS.1', title: 'Choose', description: null, success_criteria: 'I can', active: true, content_block_id: 12, content_block_title: 'Block 12' }],
  content_blocks: [
    block(12, 'exercise', { submission_type_explicit: 'text_submission', metadata: { language: 'javascript', video_segments: [] } }),
    block(10, 'text', { body: 'Read me' }),
    block(14, 'checkpoint', { knowledge_check: { id: 3, prompt: 'Which?', options: ['A', 'B'], objective_code: null, attempt_count: 2, latest_attempt: null, correct_option: 1, explanation: 'Because' } }),
  ],
  prev_lesson: null,
  next_lesson: null,
} as unknown as LessonDetail

describe('block lesson draft', () => {
  it('reads every block in position order with stable keys and alignments by block', () => {
    const draft = draftFromLesson(lesson)
    expect(draft.blocks.map((item) => [item.id, item.block_type])).toEqual([[10, 'text'], [12, 'exercise'], [14, 'checkpoint']])
    expect(draft.blocks[1].submission_type).toBe('text_submission')
    expect(draft.blocks[1].metadata).toEqual({ language: 'javascript' })
    expect(draft.blocks[2].check_locked).toBe(true)
    expect(draft.alignments).toEqual([{ learning_objective_id: 5, block_key: 'b12' }])
  })

  it('duplicates a versioned block with the established original duration for its new row', () => {
    const source = { ...newBlock('video'), id: 20, s3_video_key: 'original.mp4', s3_video_duration_seconds: 300,
      metadata: { video_versions: [{ id: 'studio', label: 'Studio', s3_video_key: 'original.mp4' }] } }
    const copy = duplicateBlock(source)
    expect(copy.metadata.video_versions_duration_seconds).toBe(300)
    expect(source.metadata).not.toHaveProperty('video_versions_duration_seconds')
    const payload = draftPayload({ ...draftFromLesson(lesson), blocks: [copy] }, { baseUpdatedAt: lesson.updated_at, baseline: new Map() })
    expect(payload.blocks[0].metadata).toMatchObject({ video_versions_duration_seconds: 300 })
  })

  it('moves, inserts, duplicates and removes without changing saved ids', () => {
    const draft = draftFromLesson(lesson)
    const moved = moveBlock(draft.blocks, 2, 0)
    expect(moved.map((item) => item.id)).toEqual([14, 10, 12])
    const added = insertBlock(moved, 1, newBlock('video'))
    expect(added.map((item) => item.block_type)).toEqual(['checkpoint', 'video', 'text', 'exercise'])
    const copy = duplicateBlock(draft.blocks[2])
    expect(copy).toMatchObject({ id: null, check_locked: false, check: { prompt: 'Which?' } })
    expect(copy.key).not.toBe(draft.blocks[2].key)
    const removed = removeBlock(draft, 'b12')
    expect(removed.removed_block_ids).toEqual([12])
    expect(removed.alignments).toEqual([{ learning_objective_id: 5, block_key: null }])
  })

  it('builds a payload that lists every block in order and sends new ones with client ids', () => {
    const draft = draftFromLesson(lesson)
    const baseline = baselineFor(draft)
    const fresh = { ...newBlock('text'), body: 'New text' }
    const next = { ...draft, blocks: insertBlock(moveBlock(draft.blocks, 0, 2), 0, fresh), alignments: [{ learning_objective_id: 5, block_key: fresh.key }] }
    const payload = draftPayload(next, { baseUpdatedAt: lesson.updated_at, baseline })
    expect(payload.blocks.map((item) => item.id ?? item.client_id)).toEqual([fresh.key, 12, 14, 10])
    expect(payload.blocks[0]).toMatchObject({ block_type: 'text', body: 'New text', metadata: {} })
    expect(payload.blocks[2].knowledge_check).toEqual({ prompt: 'Which?', options: ['A', 'B'], correct_option: 1, explanation: 'Because', learning_objective_id: null })
    expect(payload.alignments).toEqual([{ learning_objective_id: 5, block_client_id: fresh.key }])
    expect(payload.blocks.some((item) => 's3_video_key' in item || 'video_segments' in item)).toBe(false)
  })

  it('leaves a running upload out of the payload until it finishes', () => {
    const videoLesson = { ...lesson, content_blocks: [block(20, 'video', { s3_video_key: 'content_videos/old.mp4' })] } as unknown as LessonDetail
    const draft = draftFromLesson(videoLesson)
    const changed = { ...draft, blocks: [{ ...draft.blocks[0], s3_video_key: 'content_videos/new.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 9 }] }
    const options = { baseUpdatedAt: 'x', baseline: baselineFor(draft) }
    expect(draftPayload(changed, { ...options, pendingUploads: new Set([20]) }).blocks[0].s3_video_key).toBeUndefined()
    expect(draftPayload(changed, options).blocks[0]).toMatchObject({ s3_video_key: 'content_videos/new.mp4', s3_video_size: 9 })
  })

  it('gives saved ids to new blocks after a save and keeps their keys', () => {
    const draft = draftFromLesson(lesson)
    const fresh = newBlock('text')
    const sent = { ...draft, blocks: [...draft.blocks, fresh], removed_block_ids: [] }
    const saved = { ...lesson, content_blocks: [...lesson.content_blocks, block(30, 'text')].map((item, position) => ({ ...item, position: [1, 0, 2, 3][position] })) } as unknown as LessonDetail
    const settled = applySavedIds(sent, sent, saved)
    expect(settled.blocks[3]).toMatchObject({ key: fresh.key, id: 30 })
    expect(draftSignature(settled)).toBe(draftSignature(applySavedIds(sent, sent, saved)))
  })

  it('explains what stops a retrieval question from saving', () => {
    const checkpoint = { ...newBlock('checkpoint'), check: emptyCheck() }
    expect(blockProblem(checkpoint)).toMatch(/Add the question/)
    expect(blockProblem({ ...checkpoint, check: { ...emptyCheck(), prompt: 'Q', options: ['A', ''] } })).toMatch(/every choice/)
    expect(blockProblem({ ...checkpoint, check: { ...emptyCheck(), prompt: 'Q', options: ['A', 'B'] } })).toMatch(/explanation/)
    expect(blockProblem({ ...checkpoint, check: { prompt: 'Q', options: ['A', 'B'], correct_option: 1, explanation: 'E', learning_objective_id: null } })).toBeNull()
    expect(blockProblem(newBlock('checkpoint'))).toBeNull()
  })

  it('queues removal of a new block deleted while its first save was in flight', () => {
    const draft = draftFromLesson(lesson)
    const added = newBlock('text')
    const sent = { ...draft, blocks: [...draft.blocks, added] }
    const now = removeBlock(sent, added.key)
    const saved = { ...lesson, content_blocks: [...lesson.content_blocks, block(20, 'text', { position: 99 })] } as unknown as LessonDetail
    const after = applySavedIds(now, sent, saved)
    expect(after.blocks.map((item) => item.id)).toEqual([10, 12, 14])
    expect(after.removed_block_ids).toEqual([20])
    expect(applySavedIds(after, sent, saved).removed_block_ids).toEqual([20])
  })

  it('gives restored new blocks fresh keys and keeps their alignments', () => {
    const draft = draftFromLesson(lesson)
    const added = newBlock('text')
    const restored = rekeyNewBlocks({ ...draft, blocks: [...draft.blocks, added], alignments: [{ learning_objective_id: 5, block_key: added.key }] })
    expect(restored.blocks[3].key).not.toBe(added.key)
    expect(restored.alignments[0].block_key).toBe(restored.blocks[3].key)
    expect(restored.blocks[0].key).toBe(draft.blocks[0].key)
  })
})

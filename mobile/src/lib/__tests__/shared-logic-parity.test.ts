import { creditedPlaybackSeconds, normalizedProgress } from '../playback-credit'
import { learnerLessonStatus } from '../learning-status'
import { isAlumniOnlyEnrollment } from '../enrollments'
import { courseWeekForSlot } from '../private-meetings'
import { normalizeVideoSegments, totalVideoSegmentSeconds } from '../video-segments'
import { normalizeMessageMarkdown } from '../message-normalization'
import { markdownToPlainText } from '../message-format'
import fixtures from '../../../../fixtures/shared-logic-parity.json'
import { videoContentType, validVideoSize } from '../video-upload-policy'
import { effectiveSubmissionType } from '../submission-type'
import truth from '../../../../fixtures/effective-submission-type.json'
import { prependOlderMessages, pinnedMessagesFrom } from '../message-state'
import type { Message } from '../types'
import { submissionTypeFor } from '../learning'
import { validateVideoAsset } from '../video-upload'
it.each(fixtures.playback)('playback $name', ({input, expected}) => expect(creditedPlaybackSeconds(input)).toBe(expected))
it.each(fixtures.ended)('ended never invents credit', r => expect(normalizedProgress(r.position,r.watched,r.duration,r.ended)).toEqual(r.expected))
it.each(fixtures.statuses)('status precedence', r => expect(learnerLessonStatus(r.input as Parameters<typeof learnerLessonStatus>[0])).toBe(r.expected))
it.each(fixtures.enrollments)('active enrollment selection', r => expect(isAlumniOnlyEnrollment(r.rows as Parameters<typeof isAlumniOnlyEnrollment>[0])).toBe(r.expected))
it.each(fixtures.meetings)('school timezone and invalid dates', r => expect(courseWeekForSlot(r.start,r.slot,r.weeks)).toBe(r.expected))
it.each(fixtures.segments)('segments normalize and union overlaps', r => { const segments=normalizeVideoSegments(r.metadata); expect(segments).toEqual(r.expected); expect(totalVideoSegmentSeconds(segments)).toBe(r.total) })
it.each(fixtures.messages)('message normalization preserves code', r => expect(normalizeMessageMarkdown(r.input)).toBe(r.expected))
it.each(fixtures.plain)('plain text formatting', r => expect(markdownToPlainText(r.input)).toBe(r.expected))

it.each(fixtures.uploads)('upload MIME and bounds', r => { expect(videoContentType(r.name,r.mime)).toBe(r.expectedMime); expect(validVideoSize(r.size)).toBe(r.valid) })

it.each(truth)('prefers server-resolved submission type (transport contract)', r => {
  expect(effectiveSubmissionType({block_type:r.block,effective_submission_type:r.expected},r.requires_github)).toBe(r.expected)
})
it('preserves older payload fallback and prefers server over raw explicit', () => {
  expect(effectiveSubmissionType({block_type:'exercise'},true)).toBe('prework_github_sync')
  expect(effectiveSubmissionType({block_type:'video'},true)).toBe('manual_complete')
  expect(effectiveSubmissionType({block_type:'exercise',submission_type:'prework_github_sync',effective_submission_type:'text_submission'},true)).toBe('text_submission')
})

it.each(fixtures.messageState)('$name', r => { const rows=prependOlderMessages(r.current as unknown as Message[],r.older as unknown as Message[]); expect(rows.map(m=>m.id)).toEqual(r.expectedIds); expect(rows.map(m=>m.body)).toEqual(r.expectedBodies) })
it('deleted pins disappear',()=>expect(pinnedMessagesFrom(fixtures.pinned as unknown as Message[])).toEqual([]))
it('native upload resolves browser-style absent MIME',()=>expect(()=>validateVideoAsset({uri:'file:///synthetic.mov',name:'synthetic.MOV',mimeType:'',size:1})).not.toThrow())
it('github flag cannot turn a video into a submission',()=>expect(submissionTypeFor({block_type:'video'} as Parameters<typeof submissionTypeFor>[0],true)).toBe('manual_complete'))

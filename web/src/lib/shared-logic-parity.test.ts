import { it, expect } from 'vitest'
import { creditedPlaybackSeconds, normalizedProgress } from './playbackCredit'
import { learnerLessonStatus, submissionStatus } from './learningStatus'
import { isAlumniOnlyEnrollment } from './enrollments'
import { courseWeekForSlot } from './privateMeetings'
import { normalizeVideoSegments, totalVideoSegmentSeconds } from './videoSegments'
import { normalizeMessageMarkdown } from './messageNormalization'
import { markdownToPlainText } from './messageFormat'
import fixtures from '../../../fixtures/shared-logic-parity.json'
import { readFileSync } from 'node:fs'
import { videoContentType, validVideoSize } from './videoUploadPolicy'
import { effectiveSubmissionType } from './submissionType'
import truth from '../../../fixtures/effective-submission-type.json'
import { mergeMessageWindow, upsertPinnedMessage } from '../pages/shared/messages/helpers'
import type { LocalMessage } from '../pages/shared/messages/types'
it.each(fixtures.playback)('playback $name', ({input, expected}) => expect(creditedPlaybackSeconds(input)).toBe(expected))
it.each(fixtures.ended)('ended never invents credit', r => expect(normalizedProgress(r.position,r.watched,r.duration,r.ended)).toEqual(r.expected))
it.each(fixtures.statuses)('status precedence', r => expect(learnerLessonStatus(r.input as Parameters<typeof learnerLessonStatus>[0])).toBe(r.expected))
it.each(fixtures.enrollments)('active enrollment selection', r => expect(isAlumniOnlyEnrollment(r.rows as Parameters<typeof isAlumniOnlyEnrollment>[0])).toBe(r.expected))
it.each(fixtures.meetings)('school timezone and invalid dates', r => expect(courseWeekForSlot(r.start,r.slot,r.weeks)).toBe(r.expected))
it.each(fixtures.segments)('segments normalize and union overlaps', r => { const segments=normalizeVideoSegments(r.metadata); expect(segments).toEqual(r.expected); expect(totalVideoSegmentSeconds(segments)).toBe(r.total) })
it.each(fixtures.messages)('message normalization preserves code', r => expect(normalizeMessageMarkdown(r.input)).toBe(r.expected))
it.each(fixtures.plain)('plain text formatting', r => expect(markdownToPlainText(r.input)).toBe(r.expected))
it('keeps playback modules byte identical', () => expect(readFileSync('src/lib/playbackCredit.ts','utf8')).toBe(readFileSync('../mobile/src/lib/playback-credit.ts','utf8')))

it.each(fixtures.uploads)('upload MIME and bounds', r => { expect(videoContentType(r.name,r.mime)).toBe(r.expectedMime); expect(validVideoSize(r.size)).toBe(r.valid) })

it.each(truth)('prefers server-resolved submission type (transport contract)', r => {
  expect(effectiveSubmissionType({block_type:r.block,effective_submission_type:r.expected},r.requires_github)).toBe(r.expected)
})
it('preserves older payload fallback and prefers server over raw explicit', () => {
  expect(effectiveSubmissionType({block_type:'exercise'},true)).toBe('prework_github_sync')
  expect(effectiveSubmissionType({block_type:'video'},true)).toBe('manual_complete')
  expect(effectiveSubmissionType({block_type:'exercise',submission_type:'prework_github_sync',effective_submission_type:'text_submission'},true)).toBe('text_submission')
})

it.each(fixtures.messageState)('$name', r => { const rows=mergeMessageWindow(r.older as unknown as LocalMessage[],r.current as unknown as LocalMessage[],true); expect(rows.map(m=>m.id)).toEqual(r.expectedIds); expect(rows.map(m=>m.body)).toEqual(r.expectedBodies) })
it('deleted pins disappear',()=>expect(upsertPinnedMessage([],fixtures.pinned[0] as unknown as LocalMessage)).toEqual([]))
it('missing grade awaits review',()=>expect(submissionStatus({grade:undefined} as unknown as Parameters<typeof submissionStatus>[0])).toBe('awaiting_review'))

it('keeps submission and upload policy twins identical',()=>{
  expect(readFileSync('src/lib/submissionType.ts','utf8')).toBe(readFileSync('../mobile/src/lib/submission-type.ts','utf8'))
  expect(readFileSync('src/lib/videoUploadPolicy.ts','utf8')).toBe(readFileSync('../mobile/src/lib/video-upload-policy.ts','utf8'))
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSubmissionDraft, readSubmissionDraft, submissionDraftKey, writeSubmissionDraft } from './submissionDrafts'

describe('submission drafts', () => {
  beforeEach(() => localStorage.clear())

  it('scopes drafts by learner, cohort, and block', () => {
    expect(submissionDraftKey({ userId: 7, cohortId: 2, blockId: 138 })).toBe('csg-learn:submission-draft:v1:7:2:138')
    expect(submissionDraftKey({ blockId: 1 })).toBe('csg-learn:submission-draft:v1:me:none:1')
  })

  it('round-trips indented code exactly', () => {
    const key = submissionDraftKey({ userId: 7, cohortId: 2, blockId: 138 })
    writeSubmissionDraft(key, { text: 'if amount < budget:\n    print("Under")' })
    const draft = readSubmissionDraft(key)
    expect(draft?.text).toBe('if amount < budget:\n    print("Under")')
    expect(draft?.savedAt).toMatch(/^\d{4}-/)
    clearSubmissionDraft(key)
    expect(readSubmissionDraft(key)).toBeNull()
  })

  it('removes empty drafts and ignores corrupt storage', () => {
    const key = 'k'
    writeSubmissionDraft(key, { text: 'x' })
    writeSubmissionDraft(key, { text: '   ' })
    expect(localStorage.getItem(key)).toBeNull()
    localStorage.setItem(key, '{not json')
    expect(readSubmissionDraft(key)).toBeNull()
  })
})

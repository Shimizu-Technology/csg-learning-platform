// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prefillCourseQuestion } from './courseQuestion'
import { composerDestinationKey, readComposerDraft, writeComposerDraft } from './messageComposerState'

beforeEach(() => localStorage.clear())
describe('course question draft handoff', () => {
  it('preserves an existing draft, appends context once, and isolates user/conversation', () => {
    const key = composerDestinationKey(7, { type: 'dm', id: 20 }, null)
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My unsent question' }] }] }
    writeComposerDraft(key, { version: 1, body: 'My unsent question', content }, localStorage)
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42?cohort_id=4', localStorage)).toBe(true)
    const first = readComposerDraft(key, localStorage)!
    expect(first.body).toContain('My unsent question\n\nCourse question: Lists')
    expect(first.content.content?.[0]).toEqual(content.content[0])
    prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42?cohort_id=4', localStorage)
    expect(readComposerDraft(key, localStorage)).toEqual(first)
    expect(readComposerDraft(composerDestinationKey(8, { type: 'dm', id: 20 }, null), localStorage)).toBeNull()
    expect(readComposerDraft(composerDestinationKey(7, { type: 'dm', id: 21 }, null), localStorage)).toBeNull()
  })
  it('does not duplicate context after the rich text editor normalizes paragraph spacing', () => {
    const key = composerDestinationKey(7, { type: 'dm', id: 20 }, null)
    const original = { version: 1 as const, body: 'Course question: Lists\n\nhttps://learn.test/lessons/42', content: { type: 'doc', content: [] } }
    writeComposerDraft(key, original, localStorage)
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42', localStorage)).toBe(true)
    expect(readComposerDraft(key, localStorage)).toEqual(original)
  })
  it('preserves a full existing draft without appending beyond the message limit', () => {
    const key = composerDestinationKey(7, { type: 'dm', id: 20 }, null)
    const original = { version: 1 as const, body: 'x'.repeat(4990), content: { type: 'doc', content: [] } }
    writeComposerDraft(key, original, localStorage)
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42', localStorage)).toBe(false)
    expect(readComposerDraft(key, localStorage)).toEqual(original)
  })
  it('reports a storage failure so navigation cannot silently lose context', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error('full') }) } as unknown as Storage
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42', storage)).toBe(false)
  })
})

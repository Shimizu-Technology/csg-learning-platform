// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { courseQuestionContext, prefillCourseQuestion } from './courseQuestion'
import { composerDestinationKey, readComposerDraft, writeComposerDraft } from './messageComposerState'

beforeEach(() => localStorage.clear())
describe('course question draft handoff', () => {
  it('preserves an existing draft, appends context once, and isolates user/conversation', () => {
    const key = composerDestinationKey(7, { type: 'dm', id: 20 }, null)
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My unsent question' }] }] }
    writeComposerDraft(key, { version: 1, body: 'My unsent question', content }, localStorage)
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42?cohort_id=4', localStorage)).toBe(true)
    const first = readComposerDraft(key, localStorage)!
    expect(first.body).toContain('My unsent question\n\nCourse question: [Lists](https://learn.test/lessons/42?cohort_id=4)')
    expect(first.content.content?.[0]).toEqual(content.content[0])
    prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42?cohort_id=4', localStorage)
    expect(readComposerDraft(key, localStorage)).toEqual(first)
    expect(readComposerDraft(composerDestinationKey(8, { type: 'dm', id: 20 }, null), localStorage)).toBeNull()
    expect(readComposerDraft(composerDestinationKey(7, { type: 'dm', id: 21 }, null), localStorage)).toBeNull()
  })
  it('does not duplicate context after the rich text editor normalizes paragraph spacing', () => {
    const key = composerDestinationKey(7, { type: 'dm', id: 20 }, null)
    const original = { version: 1 as const, body: 'Course question:   [Lists](https://learn.test/lessons/42)\n\n\n', content: { type: 'doc', content: [] } }
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
  it('writes a readable link with the lesson title instead of a raw URL', () => {
    expect(prefillCourseQuestion(7, 20, 'Loops [part 2]', 'https://learn.test/lessons/396?cohort_id=2', localStorage)).toBe(true)
    const draft = readComposerDraft(composerDestinationKey(7, { type: 'dm', id: 20 }, null), localStorage)!
    expect(draft.body).toBe('Course question: [Loops (part 2)](https://learn.test/lessons/396?cohort_id=2)\n\n')
    expect(draft.body).not.toMatch(/\n https?:\/\//)
    const paragraph = draft.content.content?.[0]
    const link = paragraph?.content?.find((node) => node.marks?.some((mark) => mark.type === 'link'))
    expect(link?.text).toBe('Loops (part 2)')
    expect(link?.marks?.[0]?.attrs?.href).toBe('https://learn.test/lessons/396?cohort_id=2')
  })
  it('keeps parentheses and spaces in the URL from ending the link early', () => {
    expect(courseQuestionContext('Lists', 'https://learn.test/lessons/42?q=a b(c)')).toBe('Course question: [Lists](https://learn.test/lessons/42?q=a%20b%28c%29)')
  })
  it('reports a storage failure so navigation cannot silently lose context', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error('full') }) } as unknown as Storage
    expect(prefillCourseQuestion(7, 20, 'Lists', 'https://learn.test/lessons/42', storage)).toBe(false)
  })
})

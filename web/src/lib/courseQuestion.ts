import { composerDestinationKey, readComposerDraft, writeComposerDraft } from './messageComposerState'

/** Uses the same root-DM draft contract as Messages; never sends a message. */
export function prefillCourseQuestion(userId: number, conversationId: number, label: string, url: string, storage: Storage) {
  const key = composerDestinationKey(userId, { type: 'dm', id: conversationId }, null)
  const previous = readComposerDraft(key, storage)
  const context = `Course question: ${label}\n${url}`
  if (previous?.body.includes(context)) return true
  const body = previous?.body.trim() ? `${previous.body}\n\n${context}\n\n` : `${context}\n\n`
  const paragraphs = context.split('\n').map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
  writeComposerDraft(key, {
    version: 1, body,
    content: { type: 'doc', content: [...(previous?.content.content || []), ...paragraphs, { type: 'paragraph' }] },
  }, storage)
  return readComposerDraft(key, storage)?.body === body
}

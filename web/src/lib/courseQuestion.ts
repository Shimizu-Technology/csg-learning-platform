import { markdownToEditorDoc } from '../components/shared/MarkdownEditor/markdownToEditorJson'
import { MESSAGE_BODY_LIMIT, messageCharacterCount, composerDestinationKey, readComposerDraft, writeComposerDraft } from './messageComposerState'
import { editorJsonToMarkdown } from './messageFormat'

/**
 * Link text without square brackets: escaped brackets would read as a Markdown
 * block in Rich mode, so "Loops [part 2]" becomes "Loops (part 2)".
 */
function linkText(text: string) {
  return text.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\\/g, '/').replace(/\s+/g, ' ').trim()
}

/** A URL that can sit inside a Markdown link's (parentheses) without ending it early. */
function linkDestination(url: string) {
  return url.trim().replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/**
 * The question's context line: a readable link with the lesson's title, not a
 * raw URL ("Course question: [Loops](https://…/lessons/42?cohort_id=4)") (U-4.11).
 * Written by the composer's own serializer, so a title like `__init__`,
 * `*args` or one with backticks is escaped and reads literally in both
 * Markdown and Rich modes.
 */
export function courseQuestionContext(label: string, url: string) {
  return editorJsonToMarkdown({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Course question: ' },
      { type: 'text', text: linkText(label), marks: [{ type: 'link', attrs: { href: linkDestination(url) } }] },
    ],
  })
}

/** Uses the same root-DM draft contract as Messages; never sends a message. */
export function prefillCourseQuestion(userId: number, conversationId: number, label: string, url: string, storage: Storage) {
  const key = composerDestinationKey(userId, { type: 'dm', id: conversationId }, null)
  const previous = readComposerDraft(key, storage)
  const context = courseQuestionContext(label, url)
  if (previous?.body.replace(/\s+/g, ' ').includes(context.replace(/\s+/g, ' '))) return true
  const body = previous?.body.trim() ? `${previous.body}\n\n${context}\n\n` : `${context}\n\n`
  if (messageCharacterCount(body) > MESSAGE_BODY_LIMIT) return false
  writeComposerDraft(key, {
    version: 1, body,
    content: { type: 'doc', content: [...(previous?.content.content || []), ...(markdownToEditorDoc(context).doc.content || []), { type: 'paragraph' }] },
  }, storage)
  return readComposerDraft(key, storage)?.body === body
}

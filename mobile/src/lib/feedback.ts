/**
 * Feedback that says nothing: empty, or only Unicode whitespace (NBSP, em space, ...) and
 * zero-width characters. A Redo needs feedback that isn't blank; the API and the web use the same
 * rule (Submission.blank_feedback?, web isBlankFeedback).
 */
export function isBlankFeedback(text: string | null | undefined) {
  return /^[\s\u200B-\u200D\u2060\uFEFF]*$/u.test(text ?? '');
}

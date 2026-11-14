import { isInsideMarkdownFence } from '@/lib/code-paste';

/**
 * The message composer on phones is the design spec's Markdown mode (§9.1):
 * the text box holds the Markdown itself, the formatting toolbar inserts
 * syntax, and Preview shows what readers will see. Rich mode (formatting as
 * you type) is web-only for now.
 *
 * Return on a touch keyboard always adds a line; Send sends. That matches the
 * web composer inside a code block, and how phone chat apps behave, so the
 * Enter-to-send setting applies to hardware keyboards on the web only.
 */

/**
 * Caret inside an open ``` fence, counting its own line, as the web composer reads it (§9.7).
 * The caret's whole line is read: "```not-a-close" with the caret before "not" doesn't close the fence.
 */
export function caretInMarkdownFence(value: string, caret: number) {
  const newline = value.indexOf('\n', caret);
  const lineEnd = newline === -1 ? value.length : newline;
  return isInsideMarkdownFence(`${value.slice(0, lineEnd)}\n`, lineEnd + 1);
}

/** Markdown mode turns off keyboard corrections for all source, including prose (§9.9). */
export function composerInputBehavior(value: string, selection: { start: number; end: number }) {
  // Markdown source is never rewritten by keyboard corrections (§9.9).
  void value;
  void selection;
  return {
    autoCorrect: false,
    spellCheck: false,
    autoCapitalize: 'none' as const,
    smartInsertDelete: false,
  };
}

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

/** Count the caret's whole line. A valid closing delimiter ends the fence on that line (§9.7). */
export function caretInMarkdownFence(value: string, caret: number) {
  const offset = Math.max(0, Math.min(caret, value.length));
  const newline = value.indexOf('\n', offset);
  const lineEnd = newline === -1 ? value.length : newline;
  return isInsideMarkdownFence(`${value.slice(0, lineEnd)}\n`, lineEnd + 1);
}

/** Enable keyboard corrections for Markdown prose unless either selection endpoint is in a fence (§9.9). */
export function composerInputBehavior(value: string, selection: { start: number; end: number }) {
  const { start, end } = selection;
  const inFence = caretInMarkdownFence(value, start) || (end !== start && caretInMarkdownFence(value, end));
  return {
    autoCorrect: !inFence,
    spellCheck: !inFence,
    autoCapitalize: inFence ? 'none' as const : 'sentences' as const,
    smartInsertDelete: false,
  };
}

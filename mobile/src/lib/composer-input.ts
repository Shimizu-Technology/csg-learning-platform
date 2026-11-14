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

/** Caret inside an open ``` fence, counting its own line, as the web composer reads it (§9.7). */
export function caretInMarkdownFence(value: string, caret: number) {
  return isInsideMarkdownFence(`${value.slice(0, caret)}\n`, caret + 1);
}

/** Inside a code fence the keyboard stops correcting, capitalizing and curling quotes, so code stays as typed. */
export function composerInputBehavior(value: string, selection: { start: number; end: number }) {
  const inCode = caretInMarkdownFence(value, selection.start);
  return {
    autoCorrect: !inCode,
    spellCheck: !inCode,
    autoCapitalize: inCode ? ('none' as const) : ('sentences' as const),
    smartInsertDelete: !inCode,
  };
}

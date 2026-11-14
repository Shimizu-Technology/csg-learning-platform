import { caretInMarkdownFence, composerInputBehavior } from '../composer-input';

describe('composer Markdown mode on phones', () => {
  it('reads an open ``` fence at the caret the way the web composer does, counting the caret line', () => {
    expect(caretInMarkdownFence('```js', 5)).toBe(true);
    expect(caretInMarkdownFence('```js\nx = 1', 11)).toBe(true);
    expect(caretInMarkdownFence('```js\nx = 1\n```', 15)).toBe(false);
    expect(caretInMarkdownFence('Run ```npm test``` first', 10)).toBe(false);
    expect(caretInMarkdownFence('plain text', 5)).toBe(false);
  });

  it('reads the whole caret line: a fence followed by more text on that line does not close it', () => {
    const value = '```js\n```not-a-close\nconst total = 1';
    expect(caretInMarkdownFence(value, 9)).toBe(true);
    expect(composerInputBehavior(value, { start: 9, end: 9 }).autoCorrect).toBe(false);
    expect(caretInMarkdownFence(value, value.length)).toBe(true);
    // A real closing fence still closes it, wherever the caret sits on that line.
    expect(caretInMarkdownFence('```js\nx\n```\nafter', 9)).toBe(false);
    expect(caretInMarkdownFence('```js\nx\n```\nafter', 16)).toBe(false);
  });

  it('turns autocorrect, spellcheck and capitalization off inside a code fence only', () => {
    expect(composerInputBehavior('Hello there', { start: 5, end: 5 })).toEqual({ autoCorrect: true, spellCheck: true, autoCapitalize: 'sentences', smartInsertDelete: true });
    const code = '```ruby\ndef full_name';
    expect(composerInputBehavior(code, { start: code.length, end: code.length })).toEqual({ autoCorrect: false, spellCheck: false, autoCapitalize: 'none', smartInsertDelete: false });
  });
});

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

  const value = 'Before\n```ruby\ndef full_name\n```\nAfter';
  const code = value.indexOf('full_name');
  const closingFence = value.lastIndexOf('```');

  it.each([
    ['in prose', 3],
    ['on the closing fence', closingFence],
    ['after the closing fence', value.length],
  ])('enables keyboard corrections with the caret %s', (_context, caret) => {
    expect(composerInputBehavior(value, { start: caret, end: caret })).toEqual({
      autoCorrect: true, spellCheck: true, autoCapitalize: 'sentences', smartInsertDelete: false,
    });
  });

  it.each([
    ['caret in code', code, code],
    ['selection end in code', 3, code],
    ['selection start in code', code, value.length],
  ])('disables keyboard corrections with the %s', (_context, start, end) => {
    expect(composerInputBehavior(value, { start, end })).toEqual({
      autoCorrect: false, spellCheck: false, autoCapitalize: 'none', smartInsertDelete: false,
    });
  });

  it('clamps a stale selection beyond the end of an open fence', () => {
    const unclosed = '```ruby\ndef full_name';
    const staleCaret = unclosed.length + 10;
    expect(composerInputBehavior(unclosed, { start: staleCaret, end: staleCaret }).autoCorrect).toBe(false);
  });
});

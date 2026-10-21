import { bodyWithCodeFence, fencedCodeInsertion, isInsideMarkdownFence, looksLikeCode, messageBodyForSend, wrapSelectionAsCode } from '../code-paste';

describe('code in messages', () => {
  it('recognises indented Python and code-like lines, but not prose', () => {
    expect(looksLikeCode('for price in prices:\n    total = total + price\nprint(total)')).toBe(true);
    expect(looksLikeCode('amount = 75\nbudget = 100')).toBe(true);
    expect(looksLikeCode('Hi! I finished E2.\nCan you check it?')).toBe(false);
    expect(looksLikeCode('print("one line")')).toBe(false);
    expect(looksLikeCode('```python\nx = 1\n```')).toBe(false);
  });

  it('sends typed multi-line code as a fenced block with its indentation intact', () => {
    expect(messageBodyForSend('for price in prices:\n    total = total + price\nprint(total)\n\n'))
      .toBe('```\nfor price in prices:\n    total = total + price\nprint(total)\n```');
    expect(messageBodyForSend('  Thanks!  ')).toBe('Thanks!');
    expect(bodyWithCodeFence('fence = "```"\nx = 1\ny = 2')).toBe('````\nfence = "```"\nx = 1\ny = 2\n````');
    expect(bodyWithCodeFence('~~~python\nx = 1\n~~~')).toBe('~~~python\nx = 1\n~~~');
  });

  it('uses a longer fence when the code contains backticks', () => {
    expect(bodyWithCodeFence('x = "``"\ny = 1')).toBe('```\nx = "``"\ny = 1\n```');
    expect(fencedCodeInsertion('Look:', 5, 5, 'a = "```"')).toBe('\n````\na = "```"\n````\n');
  });

  it('knows when the cursor is inside a fence and wraps a selection as code', () => {
    expect(isInsideMarkdownFence('```\ncode\n', 9)).toBe(true);
    expect(isInsideMarkdownFence('```\ncode\n```\n', 14)).toBe(false);
    expect(isInsideMarkdownFence('```\ncode\n    ```\nmore\n', 22)).toBe(true);
    expect(wrapSelectionAsCode('Look x = 1', 5, 10).value).toBe('Look \n```\nx = 1\n```\n');
  });
});

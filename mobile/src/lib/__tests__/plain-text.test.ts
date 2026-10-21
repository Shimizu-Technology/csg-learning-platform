import { markdownExcerpt } from '../plain-text';

describe('markdownExcerpt', () => {
  it('turns instructor markdown into plain text for cards and notifications', () => {
    expect(markdownExcerpt('**Close!** Explain *why* `"2" + "3"` joins.\n\n```python\nfor word in words:\n    print(word)\n```\n\nSee [notes](https://example.com).'))
      .toBe('Close! Explain why "2" + "3" joins. for word in words: See notes.');
  });

  it('handles empty input and truncates with an ellipsis', () => {
    expect(markdownExcerpt(null)).toBe('');
    expect(markdownExcerpt('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

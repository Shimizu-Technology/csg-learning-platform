import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { markdownExcerpt } from '../plain-text';

// The same input → excerpt pairs the API's MarkdownExcerpt and the web app read.
const { cases } = JSON.parse(readFileSync(join(__dirname, '../../../../fixtures/markdown-excerpts.json'), 'utf8')) as {
  cases: { name: string; markdown: string; excerpt: string }[];
};

describe('markdownExcerpt', () => {
  it.each(cases)('shared fixture: $name', ({ markdown, excerpt }) => {
    expect(markdownExcerpt(markdown)).toBe(excerpt);
  });

  it('handles empty input and truncates with an ellipsis', () => {
    expect(markdownExcerpt(null)).toBe('');
    expect(markdownExcerpt('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

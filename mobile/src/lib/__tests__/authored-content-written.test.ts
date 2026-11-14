import { authoredContentSource } from '../authored-content';

describe('written authored content (updates, feedback, help replies)', () => {
  it('treats a single newline as a line break only for written text', () => {
    expect(authoredContentSource('Line one\nLine two', { written: true }).html).toContain('Line one<br>Line two');
    expect(authoredContentSource('Line one\nLine two').html).not.toContain('<br>');
  });

  // Bold around inline code isn't asserted here: Jest's Babel config rewrites marked's
  // /[\p{P}\p{S}]/u into a surrogate-pair form that breaks it. Metro keeps the regex for Hermes.
  it('agrees with the web renderer on snake_case, single tildes and raw HTML', () => {
    const { html } = authoredContentSource('Run **db:migrate** for user_id at ~375px and ~400px. Use a <div>.', { written: true });
    expect(html).toContain('<strong>db:migrate</strong>');
    expect(html).toContain('user_id');
    expect(html).not.toContain('<del>');
    expect(html).toContain('&lt;div&gt;');
  });
});

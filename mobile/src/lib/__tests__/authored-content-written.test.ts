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

  it('shows an update that starts with HTML as typed, never as HTML', () => {
    const source = authoredContentSource('<div>literal</div>\n<p onclick="x()">and <b>this</b></p>', { written: true });
    expect(source.format).toBe('markdown');
    expect(source.html).toBe('<p>&lt;div&gt;literal&lt;/div&gt;<br>&lt;p onclick=&quot;x()&quot;&gt;and &lt;b&gt;this&lt;/b&gt;&lt;/p&gt;</p>\n');
  });

  it('keeps legacy HTML lesson bodies on the HTML path', () => {
    expect(authoredContentSource('<p>Lesson <strong>HTML</strong></p>')).toEqual({ format: 'html', html: '<p>Lesson <strong>HTML</strong></p>' });
  });

  it('starts written headings one level down, like the web', () => {
    expect(authoredContentSource('# Title\n\n## Section', { written: true }).html).toBe('<h2>Title</h2>\n<h3>Section</h3>\n');
    expect(authoredContentSource('# Title').html).toBe('<h1>Title</h1>\n');
  });
});

import { authoredContentSource } from '../authored-content';

describe('authored content', () => {
  it('preserves semantic HTML emitted by the course editor', () => {
    const body = '<p><strong>Great work!</strong></p><ul><li>Rails API</li><li>Tests</li></ul>';

    expect(authoredContentSource(body)).toEqual({ format: 'html', html: body });
  });

  it('preserves an image-only HTML body for the guarded native image renderer', () => {
    const body = '<img src="https://images.example.com/lesson.png" alt="Lesson diagram">';

    expect(authoredContentSource(body)).toEqual({ format: 'html', html: body });
  });

  it('continues rendering legacy Markdown without allowing raw HTML through that path', () => {
    const result = authoredContentSource('## Instructions\n\n**Build this.**\n\n<img src=x onerror="steal()">');

    expect(result.format).toBe('markdown');
    expect(result.html).toContain('<h2>Instructions</h2>');
    expect(result.html).toContain('<strong>Build this.</strong>');
    expect(result.html).toContain('&lt;img');
    expect(result.html).not.toContain('<img src=x');
  });

  it('does not misclassify inline comparison text as stored HTML', () => {
    const result = authoredContentSource('Use value <strong> only as a literal example.');

    expect(result.format).toBe('markdown');
    expect(result.html).toContain('&lt;strong&gt;');
  });
});

describe('code block extraction', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extractCodeBlocks, markStarterLinks } = require('../authored-content') as typeof import('../authored-content');

  it('keeps the exact text of every <pre> block, including newlines and indentation', () => {
    const result = extractCodeBlocks('<p>A</p><pre><code class="language-python">if x:\n    print(&quot;&lt;ok&gt;&quot;)\n</code></pre><pre>plain\ttab</pre>');
    expect(result.blocks).toEqual([{ code: 'if x:\n    print("<ok>")', language: 'python' }, { code: 'plain\ttab', language: '' }]);
    expect(result.html).toBe('<p>A</p><csg-code data-index="0"></csg-code><csg-code data-index="1"></csg-code>');
  });

  it('marks paragraphs that only hold a starter link', () => {
    const html = '<p><a href="https://code.shimizu-technology.com/#project=a&amp;starter=b">Open starter</a></p><p>See <a href="https://x.example">x</a></p>';
    expect(markStarterLinks(html, (href) => href.includes('starter=b'))).toBe('<csg-starter href="https://code.shimizu-technology.com/#project=a&amp;starter=b">Open starter</csg-starter><p>See <a href="https://x.example">x</a></p>');
  });
});

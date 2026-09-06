import { authoredContentSource } from '../authored-content';

describe('authored content', () => {
  it('preserves semantic HTML emitted by the course editor', () => {
    const body = '<p><strong>Great work!</strong></p><ul><li>Rails API</li><li>Tests</li></ul>';

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

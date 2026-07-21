import { renderLessonMarkdown } from '../lesson-markdown';

describe('lesson markdown', () => {
  it('renders ordinary markdown while escaping authored raw HTML', () => {
    const html = renderLessonMarkdown('## Safe lesson\n\n<img src=x onerror="steal()">\n\n**Keep learning.**');
    expect(html).toContain('<h2>Safe lesson</h2>');
    expect(html).toContain('<strong>Keep learning.</strong>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('keeps safe web links and removes unsafe link and image destinations', () => {
    const html = renderLessonMarkdown('[CSG](https://codeschoolofguam.com) [bad](javascript:alert(1)) ![bad image](file:///private/token)');
    expect(html).toContain('href="https://codeschoolofguam.com/"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('file:///');
    expect(html).toContain('bad image');
  });
});

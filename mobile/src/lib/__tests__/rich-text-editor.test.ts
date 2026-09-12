import { Script } from 'node:vm';

import {
  normalizedRichTextValue,
  parseRichTextEditorMessage,
  richTextHtmlHasVisibleContent,
  richTextEditorCommandScript,
  richTextEditorContentScript,
  richTextEditorDocument,
  richTextEditorFontSize,
  sanitizedStoredRichTextValue,
  sanitizeRichTextHtml,
  safeRichTextImage,
  safeRichTextLink,
} from '../rich-text-editor';

describe('rich text editor bridge', () => {
  it('preserves stored HTML and upgrades legacy Markdown for visual editing', () => {
    expect(normalizedRichTextValue('<p><strong>Build it.</strong></p>')).toBe('<p><strong>Build it.</strong></p>');
    expect(normalizedRichTextValue('## Build it\n\nUse **Grid**.')).toContain('<h2>Build it</h2>');
    expect(normalizedRichTextValue('## Build it\n\nUse **Grid**.')).toContain('<strong>Grid</strong>');
  });

  it('only accepts the same explicit link protocols as the web authoring tool', () => {
    expect(safeRichTextLink('https://codeschoolofguam.com/lesson')).toBe('https://codeschoolofguam.com/lesson');
    expect(safeRichTextLink('mailto:hello@codeschoolofguam.com')).toBe('mailto:hello@codeschoolofguam.com');
    expect(safeRichTextLink('javascript:alert(1)')).toBeNull();
    expect(safeRichTextLink('/relative')).toBeNull();
    expect(safeRichTextLink('')).toBe('');
    expect(safeRichTextImage('https://codeschoolofguam.com/lesson.png')).toContain('https://');
    expect(safeRichTextImage('http://codeschoolofguam.com/lesson.png')).toBeNull();
  });

  it('parses only known, correctly shaped bridge messages', () => {
    expect(parseRichTextEditorMessage('{"type":"content","html":"<p>Ready</p>"}')).toEqual({ type: 'content', html: '<p>Ready</p>' });
    expect(parseRichTextEditorMessage('{"type":"height","height":300}')).toEqual({ type: 'height', height: 300 });
    expect(parseRichTextEditorMessage('{"type":"height","height":"huge"}')).toBeNull();
    expect(parseRichTextEditorMessage('{"type":"unknown"}')).toBeNull();
    expect(parseRichTextEditorMessage('not json')).toBeNull();
  });

  it('treats repeated empty blocks as blank while preserving visible content and media', () => {
    expect(richTextHtmlHasVisibleContent('<p><br></p><div><br></div><p>&nbsp;</p>')).toBe(false);
    expect(richTextHtmlHasVisibleContent('<div>\u200B</div><p>  </p>')).toBe(false);
    expect(richTextHtmlHasVisibleContent('<div><strong>Keep me</strong></div>')).toBe(true);
    expect(richTextHtmlHasVisibleContent('<p><br></p><hr><div><br></div>')).toBe(true);
    expect(richTextHtmlHasVisibleContent('<img src="https://example.com/lesson.png">')).toBe(true);
    expect(richTextHtmlHasVisibleContent('<!-- <img src="https://example.com/hidden.png"> -->')).toBe(false);
    expect(richTextHtmlHasVisibleContent('<table><tbody><tr><td><br></td></tr></tbody></table>')).toBe(false);
    expect(richTextHtmlHasVisibleContent('<table><tbody><tr><td>Useful</td></tr></tbody></table>')).toBe(true);
  });

  it('sanitizes active markup while preserving semantic HTML and untouched legacy Markdown', () => {
    expect(sanitizeRichTextHtml('<p onclick="steal()">Keep <strong style="color:red">this</strong>.</p><script>steal()</script><a href="javascript:steal()">Bad link</a>'))
      .toBe('<p>Keep <strong>this</strong>.</p><a>Bad link</a>');
    expect(sanitizedStoredRichTextValue('Use **Grid**.')).toBe('Use **Grid**.');
    expect(sanitizedStoredRichTextValue('<p onclick="steal()">Safe</p><iframe src="https://example.com"></iframe>')).toBe('<p>Safe</p>');
    expect(sanitizeRichTextHtml('<img src="http://example.com/insecure.png">')).toBe('');
  });

  it('builds an isolated editor that sanitizes imported and pasted markup', () => {
    const document = richTextEditorDocument('<p onclick="steal()">Safe</p></script><script>alert(1)</script>', 'Write <clearly>');

    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("name.startsWith('on') || blockedAttributes.has(name)");
    expect(document).toContain("editor.addEventListener('paste'");
    expect(document).toContain('editor.innerHTML = clean("\\u003cp\\u003eSafe\\u003c/p\\u003e")');
    expect(document).not.toContain('alert(1)');
    expect(document).not.toContain('onclick="steal()"');
    expect(document).toContain('Write &lt;clearly&gt;');
    const bridgeScript = document.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!bridgeScript) throw new Error('Expected the editor bridge script');
    expect(() => new Script(bridgeScript)).not.toThrow();
  });

  it('preserves large accessibility text settings and permits editor zoom', () => {
    const document = richTextEditorDocument('Readable', 'Write clearly', 2.25);

    expect(document).toContain('font-size: 36px');
    expect(document).not.toContain('maximum-scale');
    expect(richTextEditorFontSize(2.25)).toBe(36);
  });

  it('escapes content and command values before injecting them into the editor', () => {
    const script = richTextEditorContentScript('<p onclick="steal()">Safe & sound</p></script><script>steal()</script>');
    expect(script).not.toContain('</script><script>');
    expect(script).not.toContain('steal()');
    expect(script).toContain('\\u003cp\\u003eSafe \\u0026amp; sound\\u003c/p\\u003e');
    expect(richTextEditorCommandScript('setLink', 'https://example.com/?a=1&b=2')).toContain('\\u0026');
  });
});

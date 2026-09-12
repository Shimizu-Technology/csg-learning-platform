import { embeddedMediaHtml, isAllowedMediaNavigation, resolveMediaSource } from '../media-source';

describe('resolveMediaSource', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s', 'youtube', 'embed', 'dQw4w9WgXcQ', 65],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', 'youtube', 'embed', 'dQw4w9WgXcQ', 90],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'embed', 'dQw4w9WgXcQ', 0],
    ['https://vimeo.com/987654321?h=private', 'vimeo', 'embed', '987654321', 0],
    ['https://www.loom.com/share/abcdef1234567890', 'loom', 'embed', 'abcdef1234567890', 0],
    ['https://media.example.com/classes/week-1/master.m3u8?token=secret', 'direct', 'direct', 'master.m3u8', 0],
  ])('resolves %s as supported media', (url, provider, type, playbackFragment, startSeconds) => {
    const source = resolveMediaSource(url);
    expect(source).toMatchObject({ provider, type, startSeconds });
    expect(source?.playbackUrl).toContain(playbackFragment);
  });

  it('uses privacy-enhanced YouTube embeds with inline playback', () => {
    const source = resolveMediaSource('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(source?.playbackUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0&enablejsapi=1');
  });

  it('keeps arbitrary secure hosts as explicit external fallbacks', () => {
    expect(resolveMediaSource('https://example.com/replay')).toMatchObject({ provider: 'external', playbackUrl: null, type: 'external' });
  });

  it.each(['http://youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'not-a-url'])('rejects unsafe media URL %s', (url) => {
    expect(resolveMediaSource(url)).toBeNull();
  });
});

describe('isAllowedMediaNavigation', () => {
  it.each(['about:blank', 'https://learn.codeschoolofguam.com', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://player.vimeo.com/video/1', 'https://www.loom.com/embed/abcdef123'])('allows player navigation to %s', (url) => {
    expect(isAllowedMediaNavigation(url)).toBe(true);
  });

  it.each(['https://example.com/phishing', 'http://youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)'])('blocks player navigation to %s', (url) => {
    expect(isAllowedMediaNavigation(url)).toBe(false);
  });
});

describe('embeddedMediaHtml', () => {
  it('wraps generated player URLs in a restrictive, full-size document', () => {
    const source = resolveMediaSource('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30');
    if (!source) throw new Error('expected source');
    const html = embeddedMediaHtml(source);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&amp;rel=0&amp;enablejsapi=1&amp;start=30');
    expect(html).toContain('allowfullscreen');
    expect(html).not.toContain('javascript:');
  });

  it('refuses non-embed sources', () => {
    const source = resolveMediaSource('https://example.com/replay');
    if (!source) throw new Error('expected source');
    expect(() => embeddedMediaHtml(source)).toThrow('embeddable');
  });
});

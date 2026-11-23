import { runInNewContext } from 'node:vm';
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
    expect(html).toContain('youtube.com/iframe_api');
    expect(html).toContain('ReactNativeWebView.postMessage');
    expect(html).toContain('window.csgSeekTo');
    expect(html).toContain('window.csgPause');
    expect(html).toContain('pendingSeek');
    expect(html).not.toContain('javascript:');
  });

  it('queues Vimeo section jumps until its player is ready', () => {
    const source = resolveMediaSource('https://vimeo.com/123456789');
    if (!source) throw new Error('expected source');
    const html = embeddedMediaHtml(source);
    expect(html).toContain('pendingSeek');
    expect(html).toContain('player.ready().then');
    expect(html).toContain('window.csgPause');
  });

  it('reports YouTube buffering state and the last sample from the provider duration', () => {
    const html = embeddedMediaHtml(resolveMediaSource('https://youtu.be/abcdef12345')!);
    const script = html.match(/<script nonce="csg-player">([\s\S]*?)<\/script>/)![1];
    const postMessage = jest.fn();
    const events: Record<string, (event?: { data: number }) => void> = {};
    const seekTo = jest.fn();
    const playVideo = jest.fn();
    const context = {
      YT: {
        Player: jest.fn((_id, options) => {
          Object.assign(events, options.events);
          return { getDuration: () => 20, getCurrentTime: () => 8, getPlayerState: () => 2, getPlaybackRate: () => 2, seekTo, playVideo };
        }),
        PlayerState: { ENDED: 0, PLAYING: 1, BUFFERING: 3 },
      },
      window: { ReactNativeWebView: { postMessage } },
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
    };
    runInNewContext(script + '\nwindow.csgSeekTo(25, true); onYouTubeIframeAPIReady();', context);
    expect(seekTo).not.toHaveBeenCalled();
    events.onReady();
    expect(seekTo).toHaveBeenCalledWith(20, true);
    expect(playVideo).toHaveBeenCalledTimes(1);
    events.onStateChange({ data: 3 });
    expect(JSON.parse(postMessage.mock.lastCall![0])).toMatchObject({ buffering: true, playing: false, position: 8 });
    events.onStateChange({ data: 0 });
    expect(JSON.parse(postMessage.mock.lastCall![0])).toMatchObject({ ended: true, playing: false, position: 20 });
  });

  it('uses synchronized progress as the resume point', () => {
    const source = resolveMediaSource('https://youtube.com/watch?v=dQw4w9WgXcQ&t=30');
    if (!source) throw new Error('expected source');
    expect(embeddedMediaHtml(source, 95)).toContain('start=95');
  });

  it('refuses non-embed sources', () => {
    const source = resolveMediaSource('https://example.com/replay');
    if (!source) throw new Error('expected source');
    expect(() => embeddedMediaHtml(source)).toThrow('embeddable');
  });
});

it.each(['www', 'm'])('normalizes a %s-prefixed configured application hostname', (prefix) => {
  jest.isolateModules(() => {
    jest.doMock('../brand', () => ({ brand: { appUrl: `https://${prefix}.example.edu` } }));
    try {
      const { isAllowedMediaNavigation: allows } = require('../media-source');
      expect(allows(`https://${prefix}.example.edu/lesson`)).toBe(true);
      expect(allows('https://example.edu/lesson')).toBe(true);
      expect(allows('https://other.example.edu/lesson')).toBe(false);
    } finally {
      jest.dontMock('../brand');
    }
  });
});

it.each([
  ['https://vimeo.com/123456/98765', '98765'],
  ['https://player.vimeo.com/video/123456?h=aBc123', 'aBc123'],
  ['https://player.vimeo.com/video/123456?h=98765', '98765'],
  ['https://vimeo.com/channels/1234/123456', null],
])('keeps the Vimeo route ID separate from its privacy hash: %s', (url, hash) => {
  const playback = new URL(resolveMediaSource(url)!.playbackUrl!);
  expect(playback.pathname).toBe('/video/123456');
  expect(playback.searchParams.get('h')).toBe(hash);
});

export type MediaProvider = 'youtube' | 'vimeo' | 'loom' | 'direct' | 'external';

export type MediaSource = {
  originalUrl: string;
  provider: MediaProvider;
  providerLabel: string;
  playbackUrl: string | null;
  startSeconds: number;
  type: 'embed' | 'direct' | 'external';
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const LOOM_ID = /^[A-Za-z0-9_-]{8,80}$/;
const DIRECT_VIDEO_EXTENSION = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;

export function resolveMediaSource(value: string | null | undefined): MediaSource | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const originalUrl = url.toString();
  const host = normalizedHost(url.hostname);
  const startSeconds = readStartSeconds(url);

  const youtubeId = youtubeVideoId(url, host);
  if (youtubeId) {
    const playback = new URL(`https://www.youtube-nocookie.com/embed/${youtubeId}`);
    playback.searchParams.set('playsinline', '1');
    playback.searchParams.set('rel', '0');
    playback.searchParams.set('enablejsapi', '1');
    if (startSeconds > 0) playback.searchParams.set('start', String(startSeconds));
    return { originalUrl, provider: 'youtube', providerLabel: 'YouTube', playbackUrl: playback.toString(), startSeconds, type: 'embed' };
  }

  const vimeoId = vimeoVideoId(url, host);
  if (vimeoId) {
    const playback = new URL(`https://player.vimeo.com/video/${vimeoId}`);
    playback.searchParams.set('playsinline', '1');
    const hash = url.searchParams.get('h');
    if (hash) playback.searchParams.set('h', hash);
    if (startSeconds > 0) playback.hash = `t=${startSeconds}s`;
    return { originalUrl, provider: 'vimeo', providerLabel: 'Vimeo', playbackUrl: playback.toString(), startSeconds, type: 'embed' };
  }

  const loomId = loomVideoId(url, host);
  if (loomId) {
    return { originalUrl, provider: 'loom', providerLabel: 'Loom', playbackUrl: `https://www.loom.com/embed/${loomId}`, startSeconds: 0, type: 'embed' };
  }

  if (DIRECT_VIDEO_EXTENSION.test(url.pathname)) {
    return { originalUrl, provider: 'direct', providerLabel: 'Hosted video', playbackUrl: originalUrl, startSeconds, type: 'direct' };
  }

  return { originalUrl, provider: 'external', providerLabel: 'Original host', playbackUrl: null, startSeconds: 0, type: 'external' };
}

export function isAllowedMediaNavigation(value: string) {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = normalizedHost(url.hostname);
    return host === 'learn.codeschoolofguam.com'
      || host === 'youtube-nocookie.com'
      || host.endsWith('.youtube-nocookie.com')
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'vimeo.com'
      || host.endsWith('.vimeo.com')
      || host === 'loom.com'
      || host.endsWith('.loom.com');
  } catch {
    return false;
  }
}

export function embeddedMediaHtml(source: MediaSource, initialPosition = source.startSeconds) {
  if (source.type !== 'embed' || !source.playbackUrl) throw new Error('An embeddable media source is required.');
  const playbackUrl = new URL(source.playbackUrl);
  const resumeAt = Math.max(0, Math.floor(initialPosition));
  if (source.provider === 'youtube') {
    playbackUrl.searchParams.set('origin', 'https://learn.codeschoolofguam.com');
    if (resumeAt > 0) playbackUrl.searchParams.set('start', String(resumeAt));
  } else if (source.provider === 'vimeo' && resumeAt > 0) {
    playbackUrl.hash = `t=${resumeAt}s`;
  }

  const frameSource = escapeHtmlAttribute(playbackUrl.toString());
  const title = escapeHtmlAttribute(`${source.providerLabel} video player`);
  const bridge = source.provider === 'youtube'
    ? `<script nonce="csg-player" src="https://www.youtube.com/iframe_api"></script><script nonce="csg-player">var timer=null;var player=null;var playerReady=false;var pendingSeek=null;function emit(player,ended){try{var position=player.getCurrentTime()||0;var duration=player.getDuration()||0;window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',position:position,duration:duration,playing:player.getPlayerState()===1,ended:!!ended}));}catch(e){}}function applySeek(request){if(!request||!playerReady||!player)return false;player.seekTo(request.seconds,true);if(request.play)player.playVideo();return true;}window.csgSeekTo=function(seconds,play){pendingSeek={seconds:seconds,play:play};if(applySeek(pendingSeek))pendingSeek=null;};function onYouTubeIframeAPIReady(){player=new YT.Player('player-frame',{events:{onReady:function(){playerReady=true;if(applySeek(pendingSeek))pendingSeek=null;emit(player,false);},onStateChange:function(event){var ended=event.data===YT.PlayerState.ENDED;emit(player,ended);if(event.data===YT.PlayerState.PLAYING&&!timer){timer=setInterval(function(){emit(player,false);},1000);}if(event.data!==YT.PlayerState.PLAYING&&timer){clearInterval(timer);timer=null;}}}});}</script>`
    : source.provider === 'vimeo'
      ? `<script nonce="csg-player" src="https://player.vimeo.com/api/player.js"></script><script nonce="csg-player">var player=new Vimeo.Player(document.getElementById('player-frame'));var playerReady=false;var pendingSeek=null;function applySeek(request){if(!request||!playerReady)return false;player.setCurrentTime(request.seconds).then(function(){if(request.play)return player.play();});return true;}window.csgSeekTo=function(seconds,play){pendingSeek={seconds:seconds,play:play};if(applySeek(pendingSeek))pendingSeek=null;};player.ready().then(function(){playerReady=true;if(applySeek(pendingSeek))pendingSeek=null;});function emit(data,playing,ended){window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',position:data.seconds||0,duration:data.duration||0,playing:playing,ended:!!ended}));}player.on('timeupdate',function(data){emit(data,true,false);});player.on('pause',function(data){emit(data,false,false);});player.on('ended',function(data){emit(data,false,true);});</script>`
      : '';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com; script-src 'nonce-csg-player' https://www.youtube.com https://player.vimeo.com; style-src 'unsafe-inline'"><style>html,body,iframe{width:100%;height:100%;margin:0;padding:0;border:0;background:#030408;overflow:hidden}</style></head><body><iframe id="player-frame" src="${frameSource}" title="${title}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>${bridge}</body></html>`;
}

function normalizedHost(value: string) {
  return value.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
}

function youtubeVideoId(url: URL, host: string) {
  let candidate: string | null = null;
  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || null;
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
    const parts = url.pathname.split('/').filter(Boolean);
    candidate = url.searchParams.get('v') || (['embed', 'shorts', 'live'].includes(parts[0] || '') ? parts[1] : null);
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function vimeoVideoId(url: URL, host: string) {
  if (host !== 'vimeo.com' && !host.endsWith('.vimeo.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[0] === 'video' ? parts[1] : [...parts].reverse().find((part) => /^\d+$/.test(part));
  return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

function loomVideoId(url: URL, host: string) {
  if (host !== 'loom.com' && !host.endsWith('.loom.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const prefixIndex = parts.findIndex((part) => part === 'share' || part === 'embed');
  const candidate = prefixIndex >= 0 ? parts[prefixIndex + 1] : null;
  return candidate && LOOM_ID.test(candidate) ? candidate : null;
}

function readStartSeconds(url: URL) {
  const raw = url.searchParams.get('start') || url.searchParams.get('t') || url.hash.match(/(?:^#|[?&])t=([^&]+)/)?.[1] || '';
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function escapeHtmlAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

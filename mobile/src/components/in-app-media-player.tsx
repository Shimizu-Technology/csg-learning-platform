import { brand } from '../lib/brand'
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { fonts } from '@/constants/csg-theme';
import { openExternalPage } from '@/lib/external-links';
import { embeddedMediaHtml, isAllowedMediaNavigation, resolveMediaSource } from '@/lib/media-source';
import type { VideoProgressInput } from '@/lib/types';
import { observedSectionSeconds, SeekSettlement, type PlaybackSample } from '@/lib/section-watch';
import { creditedPlaybackSeconds, normalizedProgress, PROGRESS_SAVE_INTERVAL_MS } from '@/lib/video-progress';
import { NativeVideoPlayer, type NativeVideoPlayerHandle } from './native-video-player';

interface InAppMediaPlayerProps {
  initialPosition?: number;
  initialTotalWatched?: number;
  saveProgress?: (progress: VideoProgressInput) => Promise<void>;
  stopAtSeconds?: number | null;
  onStopAtReached?: () => void;
  onPlaybackSample?: PlaybackSample;
  title: string;
  completionSaved?: boolean;
  trackProgress?: boolean;
  url: string;
}

export interface InAppMediaPlayerHandle { seekTo: (seconds: number, play?: boolean, stopAtSeconds?: number) => void }

export const InAppMediaPlayer = forwardRef<InAppMediaPlayerHandle, InAppMediaPlayerProps>(function InAppMediaPlayer({ initialPosition = 0, initialTotalWatched = 0, saveProgress, stopAtSeconds = null, onStopAtReached, onPlaybackSample, title, completionSaved, trackProgress = false, url }, ref) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const source = useMemo(() => resolveMediaSource(url), [url]);
  const directPlaybackUrl = source?.type === 'direct' ? source.playbackUrl : null;
  const fetchDirectStream = useCallback(async () => {
    if (!directPlaybackUrl) throw new Error('Video is unavailable.');
    return { stream_url: directPlaybackUrl, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  }, [directPlaybackUrl]);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [initialEmbedPosition] = useState(initialPosition);
  const currentTimeRef = useRef(initialPosition);
  const durationRef = useRef(0);
  const totalWatchedRef = useRef(initialTotalWatched);
  const lastTimeRef = useRef(initialPosition);
  const lastTickAtRef = useRef(0);
  const lastSavedAtRef = useRef(0);
  const pendingSaveRef = useRef<VideoProgressInput | null>(null);
  const savingRef = useRef(false);
  const saveProgressRef = useRef(saveProgress);
  const trackProgressRef = useRef(trackProgress);
  // Layout effects update the guard before passive cleanup or queued saves run.
  useLayoutEffect(() => {
    saveProgressRef.current = saveProgress;
    trackProgressRef.current = trackProgress;
    if (!trackProgress) pendingSaveRef.current = null;
  }, [saveProgress, trackProgress]);
  const webViewRef = useRef<WebView>(null);
  const nativeVideoRef = useRef<NativeVideoPlayerHandle>(null);
  const pendingWebSeekRef = useRef<{ seconds: number; play: boolean } | null>(null);
  const pendingSectionSeek = useRef<SeekSettlement | null>(null);
  const autoPauseAt = useRef<number | null>(null);
  const anchored = useRef(false);
  const stopAtSecondsRef = useRef(stopAtSeconds);
  const onStopAtReachedRef = useRef(onStopAtReached);
  const onPlaybackSampleRef = useRef(onPlaybackSample);
  const openOriginal = useCallback(() => void openExternalPage(source?.originalUrl).catch(() => undefined), [source?.originalUrl]);

  useEffect(() => {
    stopAtSecondsRef.current = stopAtSeconds;
    onStopAtReachedRef.current = onStopAtReached;
    onPlaybackSampleRef.current = onPlaybackSample;
  }, [onPlaybackSample, onStopAtReached, stopAtSeconds]);

  const drainSaves = useCallback(async () => {
    if (savingRef.current || !saveProgressRef.current) return;
    savingRef.current = true;
    try {
      while (trackProgressRef.current && pendingSaveRef.current && saveProgressRef.current) {
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await saveProgressRef.current(next);
          setSyncError(false);
        } catch {
          setSyncError(true);
        }
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  const enqueueProgress = useCallback((ended = false) => {
    if (!trackProgressRef.current || !saveProgressRef.current) return;
    const next = normalizedProgress(currentTimeRef.current, totalWatchedRef.current, durationRef.current, ended);
    if (!next) return;
    pendingSaveRef.current = next;
    void drainSaves();
  }, [drainSaves]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let message: { type?: string; position?: number; duration?: number; playing?: boolean; ended?: boolean; rate?: number; seeking?: boolean; settled?: boolean; buffering?: boolean };
    try {
      message = JSON.parse(event.nativeEvent.data) as typeof message;
    } catch {
      return;
    }
    if (message.type !== 'progress' || !Number.isFinite(message.position) || !Number.isFinite(message.duration)) return;

    const position = Math.max(0, Number(message.position));
    const duration = Math.max(0, Number(message.duration));
    const now = Date.now();
    const elapsed = lastTickAtRef.current ? Math.max(0, (now - lastTickAtRef.current) / 1000) : 0;
    const previousPlaying = playingRef.current;
    const playing = Boolean(message.playing && !message.buffering && !message.seeking);
    playingRef.current = playing;
    const wait = pendingSectionSeek.current?.sample(position, now, Boolean(message.seeking && !message.settled));
    if (wait === 'landed' || wait === 'expired') pendingSectionSeek.current = null;
    if (wait === 'expired') {
      stopAtSecondsRef.current = null;
      onStopAtReachedRef.current?.();
    }
    const observed = creditedPlaybackSeconds({
      previousTime: lastTimeRef.current,
      currentTime: position,
      elapsedWallSeconds: elapsed,
      playbackRate: message.rate ?? 1,
      playing: !wait && !message.seeking && !message.buffering && (playing || previousPlaying || Boolean(message.ended)),
    });
    const watched = observedSectionSeconds(observed, elapsed, message.rate ?? 1);
    totalWatchedRef.current += onPlaybackSampleRef.current ? watched : observed;
    onPlaybackSampleRef.current?.(lastTimeRef.current, position, watched);
    currentTimeRef.current = position;
    durationRef.current = duration;
    lastTimeRef.current = position;
    lastTickAtRef.current = now;
    setPlaying(playing);
    const stopAt = stopAtSecondsRef.current;
    if (stopAt !== null && !wait && !message.seeking && position >= stopAt) {
      stopAtSecondsRef.current = null;
      if (!message.ended && playing) {
        autoPauseAt.current = now;
        webViewRef.current?.injectJavaScript('window.csgPause && window.csgPause(); true;');
      }
      onStopAtReachedRef.current?.();
      lastSavedAtRef.current = now;
      enqueueProgress(Boolean(message.ended));
      return;
    }
    if (message.ended) {
      if (stopAtSecondsRef.current !== null) {
        stopAtSecondsRef.current = null;
        onStopAtReachedRef.current?.();
      }
      setCompleted(true);
    }
    if (!playing && autoPauseAt.current !== null) {
      const automatic = now - autoPauseAt.current < 2_000;
      autoPauseAt.current = null;
      if (automatic && !message.ended) return;
    }
    const firstPlay = playing && !anchored.current && duration > 0;
    if (firstPlay) anchored.current = true;
    const paused = previousPlaying && !playing && !message.seeking && !message.buffering;
    if (firstPlay || message.ended || paused || (playing && now - lastSavedAtRef.current >= PROGRESS_SAVE_INTERVAL_MS)) {
      lastSavedAtRef.current = now;
      enqueueProgress(Boolean(message.ended));
    }
  }, [enqueueProgress]);

  useEffect(() => () => {
    const pending = normalizedProgress(currentTimeRef.current, totalWatchedRef.current, durationRef.current);
    if (trackProgressRef.current && pending && saveProgressRef.current) void saveProgressRef.current(pending).catch(() => undefined);
  }, []);

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number, play = true, selectedStopAt?: number) {
      const requested = Math.max(0, Math.floor(seconds));
      if (source?.type === 'direct') {
        nativeVideoRef.current?.seekTo(requested, play, selectedStopAt);
        return;
      }
      if (source?.type !== 'embed') return;
      if (selectedStopAt !== undefined) {
        stopAtSecondsRef.current = selectedStopAt;
        pendingSectionSeek.current = new SeekSettlement(durationRef.current > 0 ? Math.min(requested, durationRef.current) : requested);
      }
      pendingWebSeekRef.current = { seconds: requested, play };
      webViewRef.current?.injectJavaScript(`window.csgSeekTo && window.csgSeekTo(${requested}, ${play ? 'true' : 'false'}); true;`);
    },
  }), [source?.type]);

  if (!source) return <UnsupportedMedia title={title} url={url} />;
  if (source.type === 'direct' && directPlaybackUrl) {
    return <View style={styles.stack}>
      <NativeVideoPlayer
        ref={nativeVideoRef}
        fetchStream={fetchDirectStream}
        initialPosition={initialPosition || source.startSeconds}
        initialTotalWatched={initialTotalWatched}
        saveProgress={saveProgress || (() => Promise.resolve())}
        stopAtSeconds={stopAtSeconds}
        onStopAtReached={onStopAtReached}
        onPlaybackSample={onPlaybackSample}
        title={title}
        completionSaved={completionSaved}
        trackProgress={trackProgress && Boolean(saveProgress)}
      />
      <OriginalLink label="Open original video" onPress={openOriginal} />
    </View>;
  }
  if (source.type === 'external' || !source.playbackUrl) return <UnsupportedMedia title={title} url={source.originalUrl} />;
  const supportsProgress = source.provider === 'youtube' || source.provider === 'vimeo';
  const html = embeddedMediaHtml(source, Math.max(initialEmbedPosition, source.startSeconds));

  return <View style={styles.shell}>
    <View style={styles.webWrap}>
      <WebView
        ref={webViewRef}
        key={reloadKey}
        accessibilityLabel={`${title} ${source.providerLabel} player`}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        javaScriptEnabled
        mediaPlaybackRequiresUserAction
        onError={() => { setLoading(false); setError(true); }}
        onHttpError={() => { setLoading(false); setError(true); }}
        onLoadEnd={() => {
          setLoading(false);
          const pending = pendingWebSeekRef.current;
          if (!pending) return;
          webViewRef.current?.injectJavaScript(`window.csgSeekTo && window.csgSeekTo(${pending.seconds}, ${pending.play ? 'true' : 'false'}); true;`);
          pendingWebSeekRef.current = null;
        }}
        onLoadStart={() => { setLoading(true); setError(false); }}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={(request) => isAllowedMediaNavigation(request.url)}
        originWhitelist={['https://*', 'about:blank']}
        source={{ html, baseUrl: `${brand.appUrl}` }}
        style={styles.web}
      />
      {loading && <View pointerEvents="none" style={styles.overlay}><RefreshCw color={c.text.body} size={24} /><Text style={styles.overlayText}>Loading {source.providerLabel}…</Text></View>}
      {error && <View style={styles.overlay}><AlertCircle color={c.text.body} size={27} /><Text style={styles.errorTitle}>This video could not load here</Text><Text style={styles.errorCopy}>The host may have disabled embedded playback. You can retry or open the original.</Text><Button variant="secondary" accessibilityRole="button" accessibilityLabel="Retry in-app playback" onPress={() => setReloadKey((value) => value + 1)} style={styles.retry}><RefreshCw color={c.text.strong} size={16} /><Text style={styles.retryText}>Retry</Text></Button></View>}
    </View>
    <View style={styles.footer}><View><Text style={styles.provider}>{source.providerLabel.toUpperCase()}</Text><Text style={[styles.inline, syncError && !onPlaybackSample && styles.syncError]}>{!trackProgress || !supportsProgress ? 'Plays securely inside the app' : syncError && !onPlaybackSample ? 'Progress will retry' : (completionSaved ?? completed) ? 'Watched' : playing ? 'Watching' : onPlaybackSample ? 'Paused' : 'Progress saved'}</Text></View><OriginalLink label="Open original" onPress={openOriginal} /></View>
  </View>;
});

function UnsupportedMedia({ title, url }: { title: string; url: string }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const source = resolveMediaSource(url);
  const validUrl = source?.originalUrl;
  return <View style={styles.unsupported}><AlertCircle color={c.status.warning.fg} size={24} /><View style={styles.unsupportedCopy}><Text style={styles.errorTitle}>In-app playback is not available</Text><Text style={styles.errorCopy}>{validUrl ? 'This host does not provide a supported embedded player yet.' : 'This video link is invalid or does not use a secure connection.'}</Text></View>{validUrl && <OriginalLink label={`Open ${title}`} onPress={() => void openExternalPage(validUrl).catch(() => undefined)} />}</View>;
}

function OriginalLink({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={styles.original}><ExternalLink color={c.text.body} size={15} /><Text style={styles.originalText}>{label}</Text></Pressable>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  stack: { gap: 8 },
  shell: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken },
  webWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: c.surface.sunken },
  web: { flex: 1, backgroundColor: c.surface.sunken },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 22, backgroundColor: c.surface.raised },
  overlayText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  errorTitle: { color: c.status.danger.fg, fontFamily: fonts.bold, fontSize: 13, textAlign: 'center' },
  errorCopy: { color: c.status.danger.fg, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  retry: { minHeight: 44, borderRadius: 13,  paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  retryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  footer: { minHeight: 58, paddingLeft: 13, paddingRight: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  provider: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 },
  inline: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  syncError: { color: c.status.danger.fg },
  original: { minHeight: 44, borderRadius: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  originalText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  unsupported: { minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  unsupportedCopy: { gap: 4 },
}));

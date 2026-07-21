/* eslint-disable react-hooks/immutability -- expo-video's documented control API uses mutable player properties. */
import { useEventListener } from 'expo';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AlertCircle, Check, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import type { VideoProgressInput } from '@/lib/types';
import { creditedPlaybackSeconds, formatVideoTime, normalizedProgress, PROGRESS_SAVE_INTERVAL_MS, resumePosition, streamRefreshDelay } from '@/lib/video-progress';

type StreamResponse = { stream_url: string; expires_at: string };

interface NativeVideoPlayerProps {
  title: string;
  initialPosition?: number;
  initialTotalWatched?: number;
  fetchStream: () => Promise<StreamResponse>;
  saveProgress: (progress: VideoProgressInput) => Promise<void>;
  onProgressSaved?: (progress: VideoProgressInput) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function NativeVideoPlayer({ title, initialPosition = 0, initialTotalWatched = 0, fetchStream, saveProgress, onProgressSaved }: NativeVideoPlayerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [completed, setCompleted] = useState(false);
  const initialPositionRef = useRef(initialPosition);
  const totalWatchedRef = useRef(initialTotalWatched);
  const currentTimeRef = useRef(initialPosition);
  const durationRef = useRef(0);
  const playingRef = useRef(false);
  const rateRef = useRef(1);
  const lastTimeRef = useRef(initialPosition);
  const lastTickAtRef = useRef(0);
  const lastSavedAtRef = useRef(0);
  const pendingRestoreRef = useRef<{ position: number; shouldPlay: boolean } | null>(null);
  const pendingSaveRef = useRef<VideoProgressInput | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const pipActiveRef = useRef(false);
  const recoveryAtRef = useRef(0);
  const lastPlayingAtRef = useRef(0);
  const saveProgressRef = useRef(saveProgress);
  const onProgressSavedRef = useRef(onProgressSaved);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
    onProgressSavedRef.current = onProgressSaved;
  }, [onProgressSaved, saveProgress]);

  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 1;
    instance.preservesPitch = true;
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = true;
    instance.showNowPlayingNotification = true;
  });

  const drainSaves = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (pendingSaveRef.current) {
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await saveProgressRef.current(next);
          if (mountedRef.current) setSyncError(false);
          onProgressSavedRef.current?.(next);
        } catch {
          if (mountedRef.current) setSyncError(true);
        }
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  const enqueueProgress = useCallback((ended = false) => {
    const payload = normalizedProgress(currentTimeRef.current, totalWatchedRef.current, durationRef.current, ended);
    if (!payload) return;
    pendingSaveRef.current = payload;
    void drainSaves();
  }, [drainSaves]);

  const loadSource = useCallback(async (options?: { position?: number; shouldPlay?: boolean }) => {
    const position = options?.position ?? (durationRef.current > 0 ? currentTimeRef.current : initialPositionRef.current);
    const shouldPlay = options?.shouldPlay ?? playingRef.current;
    pendingRestoreRef.current = { position, shouldPlay };
    setLoading(true);
    setError(null);
    try {
      const stream = await fetchStream();
      setExpiresAt(stream.expires_at);
      await player.replaceAsync({ uri: stream.stream_url, useCaching: false, metadata: { title, artist: 'Code School of Guam' } });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The recording could not be loaded.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchStream, player, title]);

  useEffect(() => {
    void loadSource({ position: initialPositionRef.current, shouldPlay: false });
  }, [loadSource]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      void loadSource({ position: currentTimeRef.current, shouldPlay: playingRef.current });
    }, streamRefreshDelay(expiresAt));
    return () => clearTimeout(timer);
  }, [expiresAt, loadSource, player]);

  useEventListener(player, 'sourceLoad', ({ duration: loadedDuration }) => {
    setDuration(loadedDuration);
    durationRef.current = loadedDuration;
    const restore = pendingRestoreRef.current;
    const position = resumePosition(restore?.position ?? initialPositionRef.current, loadedDuration);
    player.currentTime = position;
    currentTimeRef.current = position;
    lastTimeRef.current = position;
    lastTickAtRef.current = Date.now();
    pendingRestoreRef.current = null;
    if (restore?.shouldPlay) player.play();
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setPlaying(isPlaying);
    playingRef.current = isPlaying;
    if (isPlaying) lastPlayingAtRef.current = Date.now();
    lastTimeRef.current = currentTimeRef.current;
    lastTickAtRef.current = Date.now();
    if (!isPlaying) enqueueProgress(false);
  });

  useEventListener(player, 'playbackRateChange', ({ playbackRate }) => {
    rateRef.current = playbackRate;
    setRate(playbackRate);
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: nextTime }) => {
    const now = Date.now();
    totalWatchedRef.current += creditedPlaybackSeconds({
      previousTime: lastTimeRef.current,
      currentTime: nextTime,
      elapsedWallSeconds: Math.max(0, (now - lastTickAtRef.current) / 1000),
      playbackRate: rateRef.current,
      playing: playingRef.current,
    });
    lastTimeRef.current = nextTime;
    currentTimeRef.current = nextTime;
    lastTickAtRef.current = now;
    setCurrentTime(nextTime);
    if (now - lastSavedAtRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
      lastSavedAtRef.current = now;
      enqueueProgress(false);
    }
  });

  useEventListener(player, 'playToEnd', () => {
    setCompleted(true);
    enqueueProgress(true);
  });

  useEventListener(player, 'statusChange', ({ status, error: playerError }) => {
    if (status !== 'error') return;
    setError(playerError?.message || 'Playback was interrupted. Reconnecting…');
    const now = Date.now();
    if (now - recoveryAtRef.current < 5_000) return;
    recoveryAtRef.current = now;
    void loadSource({ position: currentTimeRef.current, shouldPlay: playingRef.current || now - lastPlayingAtRef.current < 5_000 });
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        lastTimeRef.current = currentTimeRef.current;
        lastTickAtRef.current = Date.now();
        return;
      }
      if (!pipActiveRef.current && playingRef.current) player.pause();
      enqueueProgress(false);
    });
    return () => subscription.remove();
  }, [enqueueProgress, player]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const payload = normalizedProgress(currentTimeRef.current, totalWatchedRef.current, durationRef.current);
      if (payload) void saveProgressRef.current(payload).catch(() => undefined);
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
    };
  }, [player]);

  const changeRate = (nextRate: number) => {
    player.playbackRate = nextRate;
    rateRef.current = nextRate;
    setRate(nextRate);
  };

  return <View style={styles.shell}>
    <View style={styles.videoWrap}>
      <VideoView
        accessibilityLabel={`${title} video player`}
        allowsPictureInPicture
        allowsVideoFrameAnalysis={false}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        onFullscreenEnter={() => void ScreenOrientation.unlockAsync()}
        onFullscreenExit={() => void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)}
        onPictureInPictureStart={() => { pipActiveRef.current = true; }}
        onPictureInPictureStop={() => { pipActiveRef.current = false; enqueueProgress(false); }}
        player={player}
        style={styles.video}
      />
      {loading && <View style={styles.overlay}><RefreshCw color={palette.rubySoft} size={24} /><Text style={styles.overlayText}>Preparing secure playback…</Text></View>}
      {error && !loading && <View style={styles.overlay}><AlertCircle color={palette.rubySoft} size={26} /><Text style={styles.errorTitle}>Playback needs a reconnect</Text><Text numberOfLines={3} style={styles.errorCopy}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry playback" onPress={() => void loadSource()} style={styles.retry}><RefreshCw color={palette.text} size={16} /><Text style={styles.retryText}>Retry</Text></Pressable></View>}
    </View>
    <View style={styles.statusRow}><Text style={styles.time}>{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</Text>{completed ? <View style={styles.synced}><Check color={palette.success} size={13} /><Text style={styles.completeText}>Watched</Text></View> : <Text style={[styles.sync, syncError && styles.syncError]}>{syncError ? 'Progress will retry' : playing ? 'Watching' : 'Progress saved'}</Text>}</View>
    <View accessibilityLabel="Playback speed" style={styles.speedRow}>{SPEEDS.map((speed) => <Pressable key={speed} accessibilityRole="button" accessibilityLabel={`Play at ${speed} times speed`} onPress={() => changeRate(speed)} style={[styles.speed, rate === speed && styles.speedActive]}><Text style={[styles.speedText, rate === speed && styles.speedTextActive]}>{speed}×</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised },
  videoWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#030408' },
  video: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 22, backgroundColor: 'rgba(5,6,10,0.92)' },
  overlayText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11 },
  errorTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, textAlign: 'center' },
  errorCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  retry: { minHeight: 44, borderRadius: 13, backgroundColor: palette.ruby, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  retryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  statusRow: { minHeight: 38, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: palette.muted, fontFamily: fonts.medium, fontSize: 9 },
  sync: { color: palette.quiet, fontFamily: fonts.semibold, fontSize: 9 },
  syncError: { color: palette.warning },
  synced: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completeText: { color: palette.success, fontFamily: fonts.bold, fontSize: 9 },
  speedRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 10 },
  speed: { minWidth: 44, minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', flex: 1 },
  speedActive: { borderColor: '#6B2A38', backgroundColor: '#2A151B' },
  speedText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 9 },
  speedTextActive: { color: palette.rubySoft },
});

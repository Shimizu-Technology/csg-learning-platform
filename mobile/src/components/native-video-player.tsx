import { brand } from '../lib/brand'
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useEventListener } from 'expo';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AlertCircle, Check, RefreshCw } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
import { observedSectionSeconds, SeekSettlement, type PlaybackSample } from '@/lib/section-watch';
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
  stopAtSeconds?: number | null;
  onStopAtReached?: () => void;
  onPlaybackSample?: PlaybackSample;
  completionSaved?: boolean;
  trackProgress?: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export interface NativeVideoPlayerHandle { seekTo: (seconds: number, play?: boolean, stopAt?: number) => void }

export const NativeVideoPlayer = forwardRef<NativeVideoPlayerHandle, NativeVideoPlayerProps>(function NativeVideoPlayer({ title, initialPosition = 0, initialTotalWatched = 0, fetchStream, saveProgress, onProgressSaved, stopAtSeconds = null, onStopAtReached, onPlaybackSample, completionSaved, trackProgress = true }, ref) {
  const styles = useStyles();
  const { colors: c } = useTheme();
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
  const pendingSectionSeek = useRef<SeekSettlement | null>(null);
  const skipPauseSave = useRef(false);
  const anchored = useRef(false);
  const pendingSeekRef = useRef<{ position: number; shouldPlay: boolean } | null>(null);
  const pendingSaveRef = useRef<VideoProgressInput | null>(null);
  const savingRef = useRef(false);
  const lastEnqueued = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const pipActiveRef = useRef(false);
  const recoveryAtRef = useRef(0);
  const lastPlayingAtRef = useRef(0);
  const saveProgressRef = useRef(saveProgress);
  const trackProgressRef = useRef(trackProgress);
  // Layout effects update the guard before passive cleanup or queued saves run.
  useLayoutEffect(() => {
    saveProgressRef.current = saveProgress;
    trackProgressRef.current = trackProgress;
    if (!trackProgress) pendingSaveRef.current = null;
  }, [saveProgress, trackProgress]);
  const onProgressSavedRef = useRef(onProgressSaved);
  const stopAtSecondsRef = useRef(stopAtSeconds);
  const onStopAtReachedRef = useRef(onStopAtReached);
  const onPlaybackSampleRef = useRef(onPlaybackSample);
  useEffect(() => {
    onProgressSavedRef.current = onProgressSaved;
    stopAtSecondsRef.current = stopAtSeconds;
    onPlaybackSampleRef.current = onPlaybackSample;
    onStopAtReachedRef.current = onStopAtReached;
  }, [onPlaybackSample, onProgressSaved, onStopAtReached, stopAtSeconds]);

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
      while (trackProgressRef.current && pendingSaveRef.current) {
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await saveProgressRef.current(next);
          if (mountedRef.current) setSyncError(false);
          onProgressSavedRef.current?.(next);
        } catch {
          if (lastEnqueued.current === JSON.stringify(next)) lastEnqueued.current = null;
          if (mountedRef.current) setSyncError(true);
        }
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  const enqueueProgress = useCallback((ended = false) => {
    if (!trackProgressRef.current) return;
    const payload = normalizedProgress(currentTimeRef.current, totalWatchedRef.current, durationRef.current, ended);
    if (!payload) return;
    const key = JSON.stringify(payload);
    // Section coverage can change without changing the rounded progress payload.
    if (!onPlaybackSampleRef.current && lastEnqueued.current === key) return;
    lastEnqueued.current = key;
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
      if (mountedRef.current) setExpiresAt(stream.expires_at);
      await player.replaceAsync({ uri: stream.stream_url, useCaching: false, metadata: { title, artist: `${brand.schoolName}` } });
    } catch (loadError) {
      if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : 'The recording could not be loaded.');
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
    const restore = pendingSeekRef.current || pendingRestoreRef.current;
    const position = resumePosition(restore?.position ?? initialPositionRef.current, loadedDuration);
    if (pendingSectionSeek.current) pendingSectionSeek.current = new SeekSettlement(position);
    player.currentTime = position;
    currentTimeRef.current = position;
    lastTimeRef.current = position;
    lastTickAtRef.current = Date.now();
    pendingRestoreRef.current = null;
    pendingSeekRef.current = null;
    if (restore?.shouldPlay) player.play();
  });

  useEventListener(player, 'playbackRateChange', ({ playbackRate }) => {
    rateRef.current = playbackRate;
    setRate(playbackRate);
  });

  const observePlayback = (nextTime: number, ended = false) => {
    const now = Date.now();
    const wait = pendingSectionSeek.current?.sample(nextTime, now);
    if (wait === 'landed' || wait === 'expired') pendingSectionSeek.current = null;
    if (wait === 'expired') {
      stopAtSecondsRef.current = null;
      player.timeUpdateEventInterval = 1;
      onStopAtReachedRef.current?.();
    }
    const elapsed = Math.max(0, (now - lastTickAtRef.current) / 1000);
    const observed = creditedPlaybackSeconds({
      previousTime: lastTimeRef.current,
      currentTime: nextTime,
      elapsedWallSeconds: elapsed,
      playbackRate: rateRef.current,
      playing: !wait && (playingRef.current || ended),
    });
    const watched = observedSectionSeconds(observed, elapsed, rateRef.current);
    totalWatchedRef.current += onPlaybackSampleRef.current ? watched : observed;
    onPlaybackSampleRef.current?.(lastTimeRef.current, nextTime, watched);
    lastTimeRef.current = nextTime;
    currentTimeRef.current = nextTime;
    lastTickAtRef.current = now;
    setCurrentTime(nextTime);
    const stopAt = stopAtSecondsRef.current;
    if (!wait && stopAt !== null && nextTime >= stopAt) {
      stopAtSecondsRef.current = null;
      player.timeUpdateEventInterval = 1;
      onStopAtReachedRef.current?.();
      if (!ended && playingRef.current) {
        skipPauseSave.current = true;
        player.pause();
      }
      enqueueProgress(ended);
      return true;
    }
    if (!ended && !wait && playingRef.current && now - lastSavedAtRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
      lastSavedAtRef.current = now;
      enqueueProgress(false);
    }
  };

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setPlaying(isPlaying);
    playingRef.current = isPlaying;
    if (isPlaying) {
      lastPlayingAtRef.current = Date.now();
      skipPauseSave.current = false;
      lastTimeRef.current = player.currentTime;
      if (onPlaybackSampleRef.current && !anchored.current && durationRef.current > 0) {
        anchored.current = true;
        lastSavedAtRef.current = Date.now();
        enqueueProgress(false);
      }
      lastTickAtRef.current = Date.now();
    }
    if (!isPlaying && skipPauseSave.current) skipPauseSave.current = false;
    else if (!isPlaying) enqueueProgress(false);
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: nextTime }) => observePlayback(nextTime));

  useEventListener(player, 'playToEnd', () => {
    const saved = observePlayback(durationRef.current || player.currentTime, true);
    if (stopAtSecondsRef.current !== null) {
      stopAtSecondsRef.current = null;
      player.timeUpdateEventInterval = 1;
      onStopAtReachedRef.current?.();
    }
    if (trackProgress) setCompleted(true);
    if (!saved) enqueueProgress(true);
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
      if (trackProgressRef.current && payload) void saveProgressRef.current(payload).catch(() => undefined);
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
    };
  }, [player]);

  const changeRate = (nextRate: number) => {
    player.playbackRate = nextRate;
    rateRef.current = nextRate;
    setRate(nextRate);
  };

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number, shouldPlay = true, stopAt?: number) {
      const requested = Math.max(0, Math.floor(seconds));
      if (stopAt !== undefined) {
        stopAtSecondsRef.current = stopAt;
        pendingSectionSeek.current = new SeekSettlement(requested);
        player.timeUpdateEventInterval = 0.25;
      }
      if (durationRef.current <= 0) {
        pendingSeekRef.current = { position: requested, shouldPlay };
        setCurrentTime(requested);
        return;
      }
      const target = Math.max(0, Math.min(durationRef.current, requested));
      if (pendingSectionSeek.current) pendingSectionSeek.current = new SeekSettlement(target);
      player.currentTime = target;
      currentTimeRef.current = target;
      lastTimeRef.current = target;
      lastTickAtRef.current = Date.now();
      setCurrentTime(target);
      if (shouldPlay) player.play();
    },
  }), [player]);

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
      {loading && <View style={styles.overlay}><RefreshCw color={c.text.body} size={24} /><Text style={styles.overlayText}>Preparing secure playback…</Text></View>}
      {error && !loading && <View style={styles.overlay}><AlertCircle color={c.text.body} size={26} /><Text style={styles.errorTitle}>Playback needs a reconnect</Text><Text numberOfLines={3} style={styles.errorCopy}>{error}</Text><Button variant="secondary" accessibilityRole="button" accessibilityLabel="Retry playback" onPress={() => void loadSource()} style={styles.retry}><RefreshCw color={c.text.strong} size={16} /><Text style={styles.retryText}>Retry</Text></Button></View>}
    </View>
    <View style={styles.statusRow}><Text style={styles.time}>{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</Text>{!trackProgress ? <Text style={styles.sync}>Preview mode</Text> : (completionSaved ?? completed) ? <View style={styles.synced}><Check color={c.status.success.fg} size={13} /><Text style={styles.completeText}>Watched</Text></View> : <Text style={[styles.sync, syncError && !onPlaybackSample && styles.syncError]}>{syncError && !onPlaybackSample ? 'Progress will retry' : playing ? 'Watching' : onPlaybackSample ? 'Paused' : 'Progress saved'}</Text>}</View>
    <View accessibilityRole="radiogroup" accessibilityLabel="Playback speed" style={styles.speedRow}>{SPEEDS.map((speed) => <Pressable key={speed} accessibilityRole="radio" accessibilityState={{ checked: rate === speed, selected: rate === speed }} accessibilityLabel={`Play at ${speed} times speed`} onPress={() => changeRate(speed)} style={[styles.speed, rate === speed && styles.speedActive]}><Text style={[styles.speedText, rate === speed && styles.speedTextActive]}>{speed}×</Text></Pressable>)}</View>
  </View>;
});

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  shell: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken },
  videoWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: c.surface.sunken },
  video: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 22, backgroundColor: c.surface.raised },
  overlayText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  errorTitle: { color: c.status.danger.fg, fontFamily: fonts.bold, fontSize: 14, textAlign: 'center' },
  errorCopy: { color: c.status.danger.fg, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  retry: { minHeight: 44, borderRadius: 13, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  retryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  statusRow: { minHeight: 38, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  sync: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  syncError: { color: c.status.danger.fg },
  synced: { backgroundColor: c.status.success.bg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 },
  completeText: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 12 },
  speedRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 10 },
  speed: { minWidth: 44, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border.subtle, alignItems: 'center', justifyContent: 'center', flex: 1 },
  speedActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 },
  speedText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  speedTextActive: { color: c.text.strong, fontFamily: fonts.extraBold },
}));

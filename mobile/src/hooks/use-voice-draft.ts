import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';

import { captureProductEvent, durationBucket, latencyBucket, type VoiceSurface } from '@/lib/analytics';
import type { CsgApi } from '@/lib/api';
import { insertVoiceDraft, restoreRawVoiceDraft, voiceEditDistanceBucket, type VoiceDraftReview } from '@/lib/voice-draft';

const PERMISSION_EXPLAINED_KEY = 'csg.voice.permission-explained.v1';
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  directory: 'cache' as const,
  isMeteringEnabled: true,
};

export type VoiceDraftState = 'idle' | 'recording' | 'transcribing' | 'review' | 'error';

interface UseVoiceDraftOptions {
  api: CsgApi;
  demo: boolean;
  surface: VoiceSurface;
  draft: string;
  selection: { start: number; end: number };
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
}

export function useVoiceDraft({ api, demo, surface, draft, selection, disabled, onDraftChange, onSelectionChange }: UseVoiceDraftOptions) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [state, setState] = useState<VoiceDraftState>('idle');
  const [review, setReview] = useState<VoiceDraftReview | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const selectionRef = useRef(selection);
  const abortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  const recordingUriRef = useRef(recordingUri);
  const recorderStateRef = useRef(recorderState);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { recordingUriRef.current = recordingUri; }, [recordingUri]);
  useEffect(() => { recorderStateRef.current = recorderState; }, [recorderState]);

  const deleteRecording = useCallback((uri: string | null) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Cache cleanup is best-effort here; the OS may already have removed it.
    }
  }, []);

  const resetAudioMode = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  const transcribe = useCallback(async (uri: string) => {
    setState('transcribing');
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    try {
      const result = await api.transcribeVoice(uri, surface, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      const rawText = result.raw_text.trim();
      const suggestedText = result.suggested_text.trim() || rawText;
      if (!rawText) {
        captureProductEvent('voice_draft_transcribed', { surface, latency_bucket: latencyBucket(Date.now() - startedAt), outcome: 'empty' });
        setError('No speech was detected. Try again a little closer to the microphone.');
        setState('error');
        return;
      }
      const inserted = insertVoiceDraft(draftRef.current, selectionRef.current, suggestedText);
      const nextReview: VoiceDraftReview = { rawText, suggestedText, prefix: inserted.prefix, suffix: inserted.suffix };
      onDraftChange(inserted.value);
      onSelectionChange(inserted.selection);
      setReview(nextReview);
      setState('review');
      setNotice(result.warnings.includes('cleanup_unavailable') ? 'The faithful transcript was used because cleanup was unavailable. Review it before sending.' : result.warnings.length ? 'Voice draft added with possible ambiguities. Review technical terms before sending.' : 'Voice draft added. Review and edit it before sending.');
      captureProductEvent('voice_draft_transcribed', { surface, latency_bucket: latencyBucket(Date.now() - startedAt), outcome: 'success' });
      captureProductEvent('voice_draft_inserted', { surface, raw_or_cleaned: suggestedText === rawText ? 'raw' : 'cleaned' });
      deleteRecording(uri);
      setRecordingUri(null);
    } catch (requestError) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const message = (requestError as Error).message;
      const outcome = /timed out/i.test(message) ? 'timeout' : /voice service|transcription|provider|configured|enabled/i.test(message) ? 'provider_error' : 'network_error';
      captureProductEvent('voice_draft_transcribed', { surface, latency_bucket: latencyBucket(Date.now() - startedAt), outcome });
      setError(message);
      setState('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [api, deleteRecording, onDraftChange, onSelectionChange, surface]);

  const stop = useCallback(async () => {
    if (stoppingRef.current || stateRef.current !== 'recording') return;
    stoppingRef.current = true;
    const durationSeconds = Math.min(90, recorderState.durationMillis / 1_000);
    try {
      if (recorderState.isRecording) await recorder.stop();
      const uri = recorder.uri || recorderState.url;
      await resetAudioMode();
      if (!uri || durationSeconds < 0.4) {
        deleteRecording(uri);
        setError('That recording was too short. Hold the microphone button state long enough to speak your message.');
        setState('error');
        return;
      }
      setRecordingUri(uri);
      captureProductEvent('voice_draft_recorded', { surface, duration_bucket: durationBucket(durationSeconds) });
      await transcribe(uri);
    } catch (recordingError) {
      setError((recordingError as Error).message || 'The recording could not be finished. Try again.');
      setState('error');
      await resetAudioMode();
    } finally {
      stoppingRef.current = false;
    }
  }, [deleteRecording, recorder, recorderState.durationMillis, recorderState.isRecording, recorderState.url, resetAudioMode, surface, transcribe]);

  useEffect(() => {
    if (state !== 'recording' || recorderState.isRecording || recorderState.durationMillis < 89_500) return;
    const timeout = setTimeout(() => void stop(), 0);
    return () => clearTimeout(timeout);
  }, [recorderState.durationMillis, recorderState.isRecording, state, stop]);

  const startRecording = useCallback(async () => {
    try {
      const currentPermission = await AudioModule.getRecordingPermissionsAsync();
      const permissionState = currentPermission.granted ? 'granted' : currentPermission.status === 'denied' ? 'denied' : 'unknown';
      captureProductEvent('voice_draft_started', { surface, permission_state: permissionState });
      let permission = currentPermission;
      if (!permission.granted) permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off. You can keep typing, or enable microphone access in device settings.');
        setState('error');
        if (!permission.canAskAgain) Alert.alert('Microphone access is off', 'Enable microphone access for CSG Connect in device settings.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      setReview(null);
      setNotice(null);
      setError(null);
      deleteRecording(recordingUriRef.current);
      setRecordingUri(null);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 90 });
      setState('recording');
    } catch (recordingError) {
      await resetAudioMode();
      setError((recordingError as Error).message || 'The microphone could not start. Try again.');
      setState('error');
    }
  }, [deleteRecording, recorder, resetAudioMode, surface]);

  const start = useCallback(async () => {
    if (disabled || stateRef.current === 'recording' || stateRef.current === 'transcribing') return;
    if (demo) {
      Alert.alert('Voice drafts need a signed-in account', 'Typing and device keyboard dictation are still available in demo mode.');
      return;
    }
    const explained = await AsyncStorage.getItem(PERMISSION_EXPLAINED_KEY);
    if (explained) return startRecording();
    Alert.alert(
      'Dictate a draft?',
      'CSG Connect records only after you continue. CSG and its transcription provider temporarily process the audio; CSG deletes its app and server copies after processing. Nothing is sent to the conversation until you review the text and press Send.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: () => void AsyncStorage.setItem(PERMISSION_EXPLAINED_KEY, 'true').catch(() => undefined).then(startRecording) },
      ],
    );
  }, [demo, disabled, startRecording]);

  const cancel = useCallback(async () => {
    const discardedStage = stateRef.current === 'recording' ? 'recording' : stateRef.current === 'transcribing' ? 'transcribing' : null;
    abortRef.current?.abort();
    if (recorderState.isRecording) await recorder.stop().catch(() => undefined);
    const uri = recorder.uri || recorderState.url || recordingUriRef.current;
    deleteRecording(uri);
    setRecordingUri(null);
    setReview(null);
    setError(null);
    setNotice(null);
    setState('idle');
    await resetAudioMode();
    if (discardedStage) captureProductEvent('voice_draft_discarded', { surface, stage: discardedStage });
  }, [deleteRecording, recorder, recorderState.isRecording, recorderState.url, resetAudioMode, surface]);

  const retry = useCallback(() => {
    if (recordingUriRef.current) void transcribe(recordingUriRef.current);
    else void start();
  }, [start, transcribe]);

  const restore = useCallback(() => {
    if (!review) return;
    const restored = restoreRawVoiceDraft(draftRef.current, review);
    if (!restored) {
      Alert.alert('Could not restore automatically', 'The text around the voice draft changed. Your edits are preserved; record again if you need a fresh transcript.');
      return;
    }
    onDraftChange(restored.value);
    onSelectionChange(restored.selection);
    setNotice('Original transcript restored. Review it before sending.');
    captureProductEvent('voice_draft_restored', { surface });
  }, [onDraftChange, onSelectionChange, review, surface]);

  const dismissReview = useCallback(() => {
    setNotice(null);
    setState('idle');
  }, []);

  const markSent = useCallback((sentDraft: string) => {
    if (review) captureProductEvent('voice_draft_sent', { surface, edit_distance_bucket: voiceEditDistanceBucket(review, sentDraft) });
    setReview(null);
    setNotice(null);
    setState('idle');
  }, [review, surface]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && stateRef.current === 'recording') {
        void cancel().then(() => {
          if (mountedRef.current) {
            setError('Recording stopped when CSG Connect left the foreground. Your typed draft is safe.');
            setState('error');
          }
        });
      }
    });
    return () => subscription.remove();
  }, [cancel]);

  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
    if (recorderStateRef.current.isRecording) void recorder.stop();
    deleteRecording(recorder.uri || recorderStateRef.current.url || recordingUriRef.current);
    void resetAudioMode();
  }, [deleteRecording, recorder, resetAudioMode]);

  return {
    state,
    review,
    error,
    notice,
    durationMillis: recorderState.durationMillis,
    metering: recorderState.metering,
    start,
    stop,
    cancel,
    retry,
    restore,
    dismissReview,
    markSent,
  };
}

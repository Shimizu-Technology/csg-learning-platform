import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';

import { analyticsClient, captureProductEvent, durationBucket, latencyBucket, type VoiceSurface } from '@/lib/analytics';
import type { CsgApi } from '@/lib/api';
import { insertVoiceDraft, restoreRawVoiceDraft, voiceDraftWithinLimit, voiceEditDistanceBucket, type VoiceDraftReview } from '@/lib/voice-draft';
import { useSharedVoiceRecorder } from '@/providers/voice-recorder-provider';

const PERMISSION_EXPLAINED_KEY = 'csg.voice.permission-explained.v1';
export const MAX_VOICE_RECORDING_SECONDS = 5 * 60;
let nextVoiceOwnerId = 0;

export type VoiceDraftState = 'idle' | 'preparing' | 'recording' | 'transcribing' | 'review' | 'error';

interface UseVoiceDraftOptions {
  api: CsgApi;
  demo: boolean;
  surface: VoiceSurface;
  draft: string;
  selection: { start: number; end: number };
  disabled?: boolean;
  maxDraftLength?: number;
  onDraftChange: (value: string) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
}

type FinalizedRecording = { uri: string | null; durationSeconds: number };

export function useVoiceDraft({ api, demo, surface, draft, selection, disabled, maxDraftLength, onDraftChange, onSelectionChange }: UseVoiceDraftOptions) {
  const { recorder, recorderState, claim, owns, release } = useSharedVoiceRecorder();
  const [state, setState] = useState<VoiceDraftState>('idle');
  const [review, setReview] = useState<VoiceDraftReview | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [owner] = useState(() => `voice-draft-${++nextVoiceOwnerId}`);
  const draftRef = useRef(draft);
  const selectionRef = useRef(selection);
  const abortRef = useRef<AbortController | null>(null);
  const finalizeRef = useRef<Promise<FinalizedRecording> | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const startAttemptRef = useRef(0);
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
      // Cache cleanup is best-effort; the OS may already have removed it.
    }
  }, []);

  const resetAudioMode = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  const finalizeRecording = useCallback(() => {
    if (finalizeRef.current) return finalizeRef.current;
    if (!owns(owner)) return Promise.resolve({ uri: recordingUriRef.current, durationSeconds: 0 });

    const operation = (async (): Promise<FinalizedRecording> => {
      const status = recorder.getStatus();
      const durationMillis = Math.max(status.durationMillis, recorderStateRef.current.durationMillis);
      if (status.isRecording) await recorder.stop();
      const uri = recorder.uri || status.url || recorderStateRef.current.url || recordingUriRef.current;
      await resetAudioMode();
      release(owner);
      return { uri, durationSeconds: Math.min(MAX_VOICE_RECORDING_SECONDS, durationMillis / 1_000) };
    })();
    finalizeRef.current = operation;
    void operation.finally(() => { if (finalizeRef.current === operation) finalizeRef.current = null; }).catch(() => undefined);
    return operation;
  }, [owner, owns, recorder, release, resetAudioMode]);

  const transcribe = useCallback(async (uri: string) => {
    setState('transcribing');
    setError(null);
    setNotice(null);
    analyticsClientStep('Voice transcription started', surface, 'transcribing');
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
        analyticsClientStep('Voice transcription found no speech', surface, 'error');
        setError('No speech was detected. Try again a little closer to the microphone.');
        setState('error');
        return;
      }
      const inserted = insertVoiceDraft(draftRef.current, selectionRef.current, suggestedText);
      if (maxDraftLength && !voiceDraftWithinLimit(inserted.value, maxDraftLength)) {
        setError(`That voice draft would exceed the ${maxDraftLength.toLocaleString()}-character limit. Shorten the current draft or record a shorter addition.`);
        setState('error');
        return;
      }
      const nextReview: VoiceDraftReview = { rawText, suggestedText, prefix: inserted.prefix, suffix: inserted.suffix };
      onDraftChange(inserted.value);
      onSelectionChange(inserted.selection);
      setReview(nextReview);
      setState('review');
      setNotice(result.warnings.includes('cleanup_unavailable') ? 'The faithful transcript was used because cleanup was unavailable. Review it before sending.' : result.warnings.length ? 'Voice draft added with possible ambiguities. Review technical terms before sending.' : 'Voice draft added. Review and edit it before sending.');
      captureProductEvent('voice_draft_transcribed', { surface, latency_bucket: latencyBucket(Date.now() - startedAt), outcome: 'success' });
      captureProductEvent('voice_draft_inserted', { surface, raw_or_cleaned: suggestedText === rawText ? 'raw' : 'cleaned' });
      analyticsClientStep('Voice draft inserted for review', surface, 'review');
      deleteRecording(uri);
      setRecordingUri(null);
    } catch (requestError) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const message = (requestError as Error).message;
      const outcome = /timed out/i.test(message) ? 'timeout' : /voice service|transcription|provider|configured|enabled/i.test(message) ? 'provider_error' : 'network_error';
      captureProductEvent('voice_draft_transcribed', { surface, latency_bucket: latencyBucket(Date.now() - startedAt), outcome });
      analyticsClientStep('Voice transcription failed', surface, outcome);
      setError(message);
      setState('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [api, deleteRecording, maxDraftLength, onDraftChange, onSelectionChange, surface]);

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording' || !owns(owner)) return;
    setState('transcribing');
    try {
      const { uri, durationSeconds } = await finalizeRecording();
      if (!mountedRef.current) { deleteRecording(uri); return; }
      if (!uri || durationSeconds < 0.4) {
        deleteRecording(uri);
        setError('That recording was too short. Tap the microphone and speak your draft before stopping.');
        setState('error');
        return;
      }
      setRecordingUri(uri);
      captureProductEvent('voice_draft_recorded', { surface, duration_bucket: durationBucket(durationSeconds) });
      analyticsClientStep('Voice recording stopped', surface, 'recorded');
      await transcribe(uri);
    } catch (recordingError) {
      if (!mountedRef.current) return;
      setError((recordingError as Error).message || 'The recording could not be finished. Try again.');
      setState('error');
      release(owner);
      await resetAudioMode();
    }
  }, [deleteRecording, finalizeRecording, owner, owns, release, resetAudioMode, surface, transcribe]);

  useEffect(() => {
    if (state !== 'recording' || recorderState.isRecording || recorderState.durationMillis < (MAX_VOICE_RECORDING_SECONDS * 1_000) - 500) return;
    const timeout = setTimeout(() => void stop(), 0);
    return () => clearTimeout(timeout);
  }, [recorderState.durationMillis, recorderState.isRecording, state, stop]);

  const startRecording = useCallback(async () => {
    if (startingRef.current || !claim(owner)) return;
    const attempt = ++startAttemptRef.current;
    startingRef.current = true;
    setState('preparing');
    try {
      const currentPermission = await AudioModule.getRecordingPermissionsAsync();
      const permissionState = currentPermission.granted ? 'granted' : currentPermission.status === 'denied' ? 'denied' : 'unknown';
      captureProductEvent('voice_draft_started', { surface, permission_state: permissionState });
      let permission = currentPermission;
      if (!permission.granted) permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        release(owner);
        setError('Microphone access is off. You can keep typing, or enable microphone access in device settings.');
        setState('error');
        if (!permission.canAskAgain) Alert.alert('Microphone access is off', 'Enable microphone access for CSG Connect in device settings.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      if (!mountedRef.current || startAttemptRef.current !== attempt || !owns(owner)) return;
      setReview(null);
      setNotice(null);
      setError(null);
      deleteRecording(recordingUriRef.current);
      setRecordingUri(null);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (!mountedRef.current || startAttemptRef.current !== attempt || !owns(owner)) {
        await resetAudioMode();
        return;
      }
      await recorder.prepareToRecordAsync();
      if (!mountedRef.current || startAttemptRef.current !== attempt || !owns(owner)) {
        await resetAudioMode();
        return;
      }
      recorder.record({ forDuration: MAX_VOICE_RECORDING_SECONDS });
      analyticsClientStep('Voice recording started', surface, 'recording');
      setState('recording');
    } catch (recordingError) {
      release(owner);
      await resetAudioMode();
      setError((recordingError as Error).message || 'The microphone could not start. Try again.');
      setState('error');
    } finally {
      startingRef.current = false;
    }
  }, [claim, deleteRecording, owner, owns, recorder, release, resetAudioMode, surface]);

  const start = useCallback(async () => {
    if (disabled || startingRef.current || stateRef.current === 'recording' || stateRef.current === 'transcribing' || stateRef.current === 'preparing') return;
    if (demo) {
      Alert.alert('Voice drafts need a signed-in account', 'Typing and device keyboard dictation are still available in demo mode.');
      return;
    }
    const explained = await AsyncStorage.getItem(PERMISSION_EXPLAINED_KEY);
    if (explained) return startRecording();
    Alert.alert(
      'Dictate a draft?',
      "CSG Connect records only after you continue. CSG and its transcription provider temporarily process the audio; CSG deletes its app and server copies after processing. Nothing is sent or saved until you review the text and use the screen's Send or Save action.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: () => void AsyncStorage.setItem(PERMISSION_EXPLAINED_KEY, 'true').catch(() => undefined).then(startRecording) },
      ],
    );
  }, [demo, disabled, startRecording]);

  const cancel = useCallback(async () => {
    startAttemptRef.current += 1;
    const discardedStage = stateRef.current === 'recording' ? 'recording' : stateRef.current === 'transcribing' ? 'transcribing' : stateRef.current === 'review' ? 'review' : null;
    abortRef.current?.abort();
    let uri = recordingUriRef.current;
    if (owns(owner)) {
      const finalized = await finalizeRecording().catch(() => ({ uri: null, durationSeconds: 0 }));
      uri = finalized.uri || uri;
    }
    deleteRecording(uri);
    setRecordingUri(null);
    setReview(null);
    setError(null);
    setNotice(null);
    setState('idle');
    if (discardedStage) captureProductEvent('voice_draft_discarded', { surface, stage: discardedStage });
  }, [deleteRecording, finalizeRecording, owner, owns, surface]);

  const retry = useCallback(() => {
    if (recordingUriRef.current) void transcribe(recordingUriRef.current);
    else void start();
  }, [start, transcribe]);

  const recordAgain = useCallback(async () => {
    abortRef.current?.abort();
    deleteRecording(recordingUriRef.current);
    setRecordingUri(null);
    setError(null);
    setState('idle');
    await startRecording();
  }, [deleteRecording, startRecording]);

  const restore = useCallback(() => {
    if (!review) return;
    const restored = restoreRawVoiceDraft(draftRef.current, review);
    if (!restored) {
      Alert.alert('Could not restore automatically', 'The text around the voice draft changed. Your edits are preserved; record again if you need a fresh transcript.');
      return;
    }
    if (maxDraftLength && !voiceDraftWithinLimit(restored.value, maxDraftLength)) {
      Alert.alert('Draft is too long', `The original transcript would exceed the ${maxDraftLength.toLocaleString()}-character limit. Your current edits are preserved.`);
      return;
    }
    onDraftChange(restored.value);
    onSelectionChange(restored.selection);
    setNotice('Original transcript restored. Review it before sending.');
    captureProductEvent('voice_draft_restored', { surface });
  }, [maxDraftLength, onDraftChange, onSelectionChange, review, surface]);

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
    startAttemptRef.current += 1;
    abortRef.current?.abort();
    if (!owns(owner)) {
      deleteRecording(recordingUriRef.current);
      return;
    }
    void finalizeRecording().then(({ uri }) => deleteRecording(uri || recordingUriRef.current)).catch(() => undefined);
  }, [deleteRecording, finalizeRecording, owner, owns]);

  return {
    state,
    review,
    error,
    notice,
    durationMillis: owns(owner) ? recorderState.durationMillis : 0,
    metering: owns(owner) ? recorderState.metering : undefined,
    hasRecording: Boolean(recordingUri),
    maxDurationSeconds: MAX_VOICE_RECORDING_SECONDS,
    start,
    stop,
    cancel,
    retry,
    recordAgain,
    restore,
    dismissReview,
    markSent,
  };
}

function analyticsClientStep(message: string, surface: VoiceSurface, voiceState: string) {
  // The breadcrumb is content-free so a native crash can be diagnosed without recording the transcript or message body.
  analyticsClient?.addExceptionStep(message, { surface, voice_state: voiceState });
}

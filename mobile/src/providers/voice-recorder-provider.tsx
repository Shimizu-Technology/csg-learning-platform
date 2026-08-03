import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useRef } from 'react';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  directory: 'cache' as const,
  isMeteringEnabled: true,
};

type VoiceRecorderContextValue = {
  recorder: ReturnType<typeof useAudioRecorder>;
  recorderState: ReturnType<typeof useAudioRecorderState>;
  claim: (owner: string) => boolean;
  owns: (owner: string) => boolean;
  release: (owner: string) => void;
};

const VoiceRecorderContext = createContext<VoiceRecorderContextValue | null>(null);

export function VoiceRecorderProvider({ children }: PropsWithChildren) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 120);
  const ownerRef = useRef<string | null>(null);
  const claim = useCallback((owner: string) => {
    if (ownerRef.current && ownerRef.current !== owner) return false;
    ownerRef.current = owner;
    return true;
  }, []);
  const owns = useCallback((owner: string) => ownerRef.current === owner, []);
  const release = useCallback((owner: string) => {
    if (ownerRef.current === owner) ownerRef.current = null;
  }, []);
  const value = useMemo<VoiceRecorderContextValue>(() => ({
    recorder,
    recorderState,
    claim,
    owns,
    release,
  }), [claim, owns, recorder, recorderState, release]);

  return <VoiceRecorderContext.Provider value={value}>{children}</VoiceRecorderContext.Provider>;
}

export function useSharedVoiceRecorder() {
  const value = useContext(VoiceRecorderContext);
  if (!value) throw new Error('useSharedVoiceRecorder must be used inside VoiceRecorderProvider');
  return value;
}

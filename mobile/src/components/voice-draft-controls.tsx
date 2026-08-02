import { Mic, RotateCcw, Square, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts, palette } from '@/constants/csg-theme';
import type { VoiceDraftState } from '@/hooks/use-voice-draft';

interface VoiceDraftButtonProps {
  state: VoiceDraftState;
  disabled?: boolean;
  onPress: () => void;
}

export function VoiceDraftButton({ state, disabled, onPress }: VoiceDraftButtonProps) {
  const busy = state === 'recording' || state === 'transcribing';
  return <Pressable accessibilityRole="button" accessibilityLabel="Dictate a draft" accessibilityHint="Records temporary audio and inserts editable text; it never sends automatically" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.iconButton, (disabled || busy) && styles.disabled, pressed && styles.pressed]}><Mic color={palette.muted} size={19} /></Pressable>;
}

interface VoiceDraftPanelProps {
  state: VoiceDraftState;
  durationMillis: number;
  metering?: number;
  error: string | null;
  notice: string | null;
  hasReview: boolean;
  onStop: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}

export function VoiceDraftPanel({ state, durationMillis, metering, error, notice, hasReview, onStop, onCancel, onRetry, onRestore, onDismiss }: VoiceDraftPanelProps) {
  if (state === 'idle') return null;
  if (state === 'recording') {
    const seconds = Math.min(90, Math.floor(durationMillis / 1_000));
    const level = Math.max(0.12, Math.min(1, ((metering ?? -60) + 60) / 60));
    return <View accessibilityLiveRegion="polite" style={styles.panel}><View style={styles.recordingCopy}><View style={styles.recordingTitle}><View style={styles.liveDot} /><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.title}>Recording draft</Text></View><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.time}>{formatTime(seconds)} / 1:30</Text><View accessibilityLabel="Microphone activity" style={styles.meter}><View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} /></View></View><Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={onCancel} style={styles.secondary}><X color={palette.muted} size={18} /><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Stop and transcribe recording" onPress={onStop} style={styles.stop}><Square color={palette.text} fill={palette.text} size={15} /><Text style={styles.stopText}>Stop</Text></Pressable></View>;
  }
  if (state === 'transcribing') return <View accessibilityLiveRegion="polite" style={styles.panel}><ActivityIndicator color={palette.rubySoft} /><View style={styles.grow}><Text style={styles.title}>Transcribing…</Text><Text style={styles.copy}>Your typed draft stays safe. Nothing will send or save automatically.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cancel transcription" onPress={onCancel} style={styles.iconButton}><X color={palette.muted} size={19} /></Pressable></View>;
  if (state === 'error') return <View accessibilityLiveRegion="polite" style={styles.reviewPanel}><View style={styles.grow}><Text style={styles.title}>Voice draft needs attention</Text><Text style={styles.copy}>{error}</Text></View><View style={styles.reviewActions}><Pressable accessibilityRole="button" onPress={onRetry} style={styles.reviewAction}><RotateCcw color={palette.rubySoft} size={16} /><Text style={styles.reviewActionText}>Retry</Text></Pressable><Pressable accessibilityRole="button" onPress={onCancel} style={styles.reviewAction}><X color={palette.muted} size={16} /><Text style={styles.reviewActionText}>Dismiss</Text></Pressable></View></View>;
  if (state === 'review' && hasReview) return <View accessibilityLiveRegion="polite" style={styles.reviewPanel}><View style={styles.grow}><Text style={styles.title}>Review your voice draft</Text><Text style={styles.copy}>{notice}</Text></View><View style={styles.reviewActions}><Pressable accessibilityRole="button" accessibilityLabel="Restore original transcript" onPress={onRestore} style={styles.reviewAction}><RotateCcw color={palette.rubySoft} size={16} /><Text style={styles.reviewActionText}>Restore original</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Dismiss voice draft review controls" onPress={onDismiss} style={styles.reviewAction}><X color={palette.muted} size={16} /><Text style={styles.reviewActionText}>Done</Text></Pressable></View></View>;
  return null;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  panel: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel },
  reviewPanel: { gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel },
  recordingCopy: { flex: 1, gap: 5 },
  recordingTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.rubySoft },
  title: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 },
  copy: { marginTop: 2, color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  time: { color: palette.muted, fontFamily: fonts.medium, fontSize: 12 },
  meter: { height: 3, overflow: 'hidden', borderRadius: 2, backgroundColor: palette.line },
  meterFill: { height: 3, borderRadius: 2, backgroundColor: palette.rubySoft },
  grow: { flex: 1 },
  secondary: { minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  secondaryText: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 },
  stop: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: palette.ruby },
  stopText: { color: palette.text, fontFamily: fonts.semibold, fontSize: 13 },
  iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reviewAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: palette.line },
  reviewActionText: { color: palette.text, fontFamily: fonts.medium, fontSize: 12 },
});

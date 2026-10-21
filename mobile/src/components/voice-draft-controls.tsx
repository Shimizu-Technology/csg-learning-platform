import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { AudioLines, CircleAlert, Mic, RotateCcw, Square, X } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import type { VoiceDraftState } from '@/hooks/use-voice-draft';

interface VoiceDraftButtonProps {
  state: VoiceDraftState;
  disabled?: boolean;
  onPress: () => void;
}

export function VoiceDraftButton({ state, disabled, onPress }: VoiceDraftButtonProps) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const busy = state === 'preparing' || state === 'recording' || state === 'transcribing';
  return <Pressable accessibilityRole="button" accessibilityLabel="Dictate a draft" accessibilityHint="Records temporary audio and inserts editable text; it never sends automatically" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.iconButton, (disabled || busy) && styles.disabled, pressed && styles.pressed]}><Mic color={state === 'recording' ? c.status.danger.fg : c.text.body} size={19} /></Pressable>;
}

interface VoiceDraftPanelProps {
  state: VoiceDraftState;
  durationMillis: number;
  maxDurationSeconds?: number;
  metering?: number;
  error: string | null;
  notice: string | null;
  hasReview: boolean;
  hasRecording?: boolean;
  onStop: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRecordAgain?: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}

export function VoiceDraftPanel({ state, durationMillis, maxDurationSeconds = 300, metering, error, notice, hasReview, hasRecording, onStop, onCancel, onRetry, onRecordAgain, onRestore, onDismiss }: VoiceDraftPanelProps) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  if (state === 'idle') return null;
  if (state === 'preparing') return <View accessibilityLiveRegion="polite" style={styles.panel}><ActivityIndicator color={c.text.body} /><View style={styles.rowGrow}><Text style={styles.title}>Getting the microphone ready…</Text><Text style={styles.copy}>Your typed draft stays exactly where it is.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cancel voice draft" onPress={onCancel} style={styles.iconButton}><X color={c.text.body} size={19} /></Pressable></View>;
  if (state === 'recording') {
    const seconds = Math.min(maxDurationSeconds, Math.floor(durationMillis / 1_000));
    const level = Math.max(0.08, Math.min(1, ((metering ?? -60) + 60) / 60));
    const remaining = Math.max(0, maxDurationSeconds - seconds);
    return <View accessibilityLiveRegion="polite" style={styles.recordingPanel}>
      <View style={styles.recordingTop}>
        <View style={styles.recordingStatus}><View style={styles.liveDot} /><View><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.title}>Listening…</Text><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.time}>{formatTime(seconds)}{remaining <= 30 ? ` · ${remaining}s left` : ''}</Text></View></View>
        <View style={styles.recordingActions}>
          <Button variant="quiet" accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={onCancel} style={styles.cancelCircle}><X color={c.text.body} size={20} /></Button>
          <Pressable accessibilityRole="button" accessibilityLabel="Stop and transcribe recording" onPress={onStop} style={styles.stopCircle}><Square color={c.text.strong} fill={c.text.strong} size={16} /></Pressable>
        </View>
      </View>
      <View accessibilityLabel="Microphone activity" style={styles.waveform}>{Array.from({ length: 24 }, (_, index) => {
        const shape = 0.45 + (Math.sin(index * 1.7) + 1) * 0.275;
        const height = 4 + Math.round(22 * level * shape);
        return <View key={index} style={[styles.waveBar, { height, opacity: 0.38 + (level * 0.62) }]} />;
      })}</View>
      <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.recordingHint}>Speak naturally. Tap stop when your draft is finished.</Text>
    </View>;
  }
  if (state === 'transcribing') return <View accessibilityLiveRegion="polite" style={styles.panel}><View style={styles.processingIcon}><AudioLines color={c.text.body} size={20} /></View><View style={styles.rowGrow}><Text style={styles.title}>Turning speech into a draft…</Text><Text style={styles.copy}>Longer recordings can take a moment. Your typed draft is safe.</Text></View><ActivityIndicator color={c.text.body} /><Pressable accessibilityRole="button" accessibilityLabel="Cancel transcription" onPress={onCancel} style={styles.iconButton}><X color={c.text.body} size={19} /></Pressable></View>;
  if (state === 'error') return <View accessibilityLiveRegion="polite" testID="voice-error-panel" style={styles.errorPanel}>
    <View style={styles.errorHeading}>
      <View style={styles.errorIcon}><CircleAlert color={c.text.body} size={19} /></View>
      <View style={styles.errorCopy}>
        <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.title}>Voice draft needs attention</Text>
        <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.copy}>{error}</Text>
        {hasRecording && <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.savedCopy}>Your recording is saved for this retry.</Text>}
      </View>
    </View>
    <View testID="voice-error-actions" style={styles.errorActions}>
      {hasRecording && <Button variant="primary" accessibilityRole="button" accessibilityLabel="Retry transcription" onPress={onRetry} style={styles.primaryAction}><RotateCcw color={c.text.strong} size={17} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.primaryActionText}>Retry transcription</Text></Button>}
      <View style={styles.errorSecondaryActions}>
        {onRecordAgain && <Pressable accessibilityRole="button" accessibilityLabel="Discard this recording and record again" onPress={onRecordAgain} style={styles.secondaryErrorAction}><Mic color={c.text.body} size={17} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.secondaryErrorActionText}>Record again</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss voice draft error" onPress={onCancel} style={styles.secondaryErrorAction}><X color={c.text.body} size={17} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.secondaryErrorActionText}>Dismiss</Text></Pressable>
      </View>
    </View>
  </View>;
  if (state === 'review' && hasReview) return <View accessibilityLiveRegion="polite" style={styles.reviewPanel}><View style={styles.reviewCopy}><Text style={styles.title}>Review your voice draft</Text><Text style={styles.copy}>{notice}</Text></View><View style={styles.reviewActions}><Pressable accessibilityRole="button" accessibilityLabel="Restore original transcript" onPress={onRestore} style={styles.reviewAction}><RotateCcw color={c.text.body} size={16} /><Text style={styles.reviewActionText}>Restore original</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Dismiss voice draft review controls" onPress={onDismiss} style={styles.reviewAction}><X color={c.text.body} size={16} /><Text style={styles.reviewActionText}>Done</Text></Pressable></View></View>;
  return null;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  panel: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised },
  recordingPanel: { gap: 9, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 11, borderTopWidth: 1, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised },
  recordingTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  recordingStatus: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  recordingActions: { flexDirection: 'row', gap: 9 },
  reviewPanel: { gap: 11, paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised },
  errorPanel: { gap: 14, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, borderTopWidth: 1, borderTopColor: c.status.danger.border, backgroundColor: c.status.danger.bg },
  errorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  errorIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.status.danger.bg },
  errorCopy: { flex: 1, minWidth: 0, paddingTop: 1 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.text.body, shadowColor: c.text.body, shadowOpacity: 0.45, shadowRadius: 5 },
  title: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 },
  copy: { marginTop: 3, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  savedCopy: { marginTop: 7, color: c.text.body, fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  time: { marginTop: 2, color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  waveform: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2, overflow: 'hidden' },
  waveBar: { width: 3, minHeight: 4, borderRadius: 2, backgroundColor: c.text.body },
  recordingHint: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  rowGrow: { flex: 1, minWidth: 0 },
  reviewCopy: { minWidth: 0 },
  processingIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken },
  cancelCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1,},
  stopCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: c.selection.bg },
  iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  errorActions: { gap: 8 },
  errorSecondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reviewAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle },
  reviewActionText: { color: c.text.strong, fontFamily: fonts.medium, fontSize: 12 },
  primaryAction: { width: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 13 },
  primaryActionText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 },
  secondaryErrorAction: { minWidth: 132, minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg },
  secondaryErrorActionText: { flexShrink: 1, color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' },
}));

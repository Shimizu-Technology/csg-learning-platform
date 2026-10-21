import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Check, Clock3, Play } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, monoFont } from '@/constants/csg-theme';
import { formatVideoDuration, formatVideoTimestamp, totalVideoSegmentSeconds, type VideoSegment, videoSegmentKey } from '@/lib/video-segments';

export function VideoSegmentControls({ segments, onSelect, activeSegment = null, completedSegment = null }: { segments: VideoSegment[]; onSelect: (segment: VideoSegment) => void; activeSegment?: VideoSegment | null; completedSegment?: VideoSegment | null }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  if (!segments.length) return null;
  const requiredSeconds = totalVideoSegmentSeconds(segments, true);
  const totalSeconds = totalVideoSegmentSeconds(segments);
  const activeKey = activeSegment ? videoSegmentKey(activeSegment) : null;
  const completedKey = completedSegment ? videoSegmentKey(completedSegment) : null;
  return <View accessibilityLabel="Recording sections" style={styles.shell}>
    <View style={styles.header}><View style={styles.icon}><Clock3 color={c.text.body} size={17} /></View><View style={styles.copy}><Text style={styles.title}>Watch the parts that matter</Text><Text style={styles.subtitle}>Tap a section to jump there. Playback pauses at its reviewed end time.</Text><Text style={styles.summary}>{requiredSeconds > 0 ? `${formatVideoDuration(requiredSeconds)} core viewing` : `${formatVideoDuration(totalSeconds)} optional viewing`}</Text></View></View>
    {segments.map((segment) => {
      const key = videoSegmentKey(segment);
      const isActive = key === activeKey;
      const isCompleted = key === completedKey;
      return <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: isActive }} accessibilityLabel={`Play ${segment.label}, ${formatVideoTimestamp(segment.start_seconds)} to ${formatVideoTimestamp(segment.end_seconds)}${isCompleted ? ', section finished' : isActive ? ', playing this section' : ''}`} onPress={() => onSelect(segment)} style={[styles.row, isActive && styles.rowActive]}><View style={[styles.play, isCompleted && styles.playDone]}>{isCompleted ? <Check color={c.status.success.fg} size={16} strokeWidth={3} /> : <Play color={c.text.strong} fill={c.text.strong} size={15} />}</View><View style={styles.copy}><Text style={styles.label}>{segment.label}</Text><Text style={styles.time}>Start {formatVideoTimestamp(segment.start_seconds)} · stop {formatVideoTimestamp(segment.end_seconds)}</Text>{(isActive || isCompleted) && <Text accessibilityLiveRegion="polite" style={[styles.state, isCompleted && styles.stateDone]}>{isCompleted ? 'Section finished' : 'Playing this section'}</Text>}</View><Text style={[styles.badge, !segment.required && styles.optional]}>{segment.required ? 'CORE' : 'OPTIONAL'}</Text></Pressable>;
    })}
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  shell: { marginTop: 10, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, overflow: 'hidden' },
  header: { minHeight: 68, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  subtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
  summary: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, marginTop: 4 },
  row: { minHeight: 64, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  rowActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2, borderBottomWidth: 2, borderBottomColor: c.selection.indicator },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' },
  playDone: { backgroundColor: c.status.success.bg},
  label: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 },
  time: { color: c.text.body, fontFamily: monoFont, fontSize: 12, marginTop: 3 },
  state: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, marginTop: 4 },
  stateDone: { color: c.status.success.fg, backgroundColor: c.status.success.bg, alignSelf: 'flex-start', borderRadius: 4, overflow: 'hidden', paddingHorizontal: 4 },
  badge: { color: c.text.body, backgroundColor: c.surface.sunken, borderRadius: 99, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 4, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6 },
  optional: { color: c.text.body, backgroundColor: c.surface.raised },
}));

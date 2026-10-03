import { Check, Clock3, Play } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { formatVideoDuration, formatVideoTimestamp, totalVideoSegmentSeconds, type VideoSegment, videoSegmentKey } from '@/lib/video-segments';

export function VideoSegmentControls({ segments, onSelect, activeSegment = null, completedSegment = null }: { segments: VideoSegment[]; onSelect: (segment: VideoSegment) => void; activeSegment?: VideoSegment | null; completedSegment?: VideoSegment | null }) {
  if (!segments.length) return null;
  const requiredSeconds = totalVideoSegmentSeconds(segments, true);
  const totalSeconds = totalVideoSegmentSeconds(segments);
  const activeKey = activeSegment ? videoSegmentKey(activeSegment) : null;
  const completedKey = completedSegment ? videoSegmentKey(completedSegment) : null;
  return <View accessibilityLabel="Recording sections" style={styles.shell}>
    <View style={styles.header}><View style={styles.icon}><Clock3 color={palette.rubySoft} size={17} /></View><View style={styles.copy}><Text style={styles.title}>Watch the parts that matter</Text><Text style={styles.subtitle}>Tap a section to jump there. Playback pauses at its reviewed end time.</Text><Text style={styles.summary}>{requiredSeconds > 0 ? `${formatVideoDuration(requiredSeconds)} core viewing` : `${formatVideoDuration(totalSeconds)} optional viewing`}</Text></View></View>
    {segments.map((segment) => {
      const key = videoSegmentKey(segment);
      const isActive = key === activeKey;
      const isCompleted = key === completedKey;
      return <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: isActive }} accessibilityLabel={`Play ${segment.label}, ${formatVideoTimestamp(segment.start_seconds)} to ${formatVideoTimestamp(segment.end_seconds)}${isCompleted ? ', section finished' : isActive ? ', playing this section' : ''}`} onPress={() => onSelect(segment)} style={[styles.row, isActive && styles.rowActive]}><View style={[styles.play, isCompleted && styles.playDone]}>{isCompleted ? <Check color={palette.text} size={16} strokeWidth={3} /> : <Play color={palette.text} fill={palette.text} size={15} />}</View><View style={styles.copy}><Text style={styles.label}>{segment.label}</Text><Text style={styles.time}>Start {formatVideoTimestamp(segment.start_seconds)} · stop {formatVideoTimestamp(segment.end_seconds)}</Text>{(isActive || isCompleted) && <Text accessibilityLiveRegion="polite" style={[styles.state, isCompleted && styles.stateDone]}>{isCompleted ? 'Section finished' : 'Playing this section'}</Text>}</View><Text style={[styles.badge, !segment.required && styles.optional]}>{segment.required ? 'CORE' : 'OPTIONAL'}</Text></Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  shell: { marginTop: 10, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, overflow: 'hidden' },
  header: { minHeight: 68, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 },
  summary: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, marginTop: 4 },
  row: { minHeight: 64, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  rowActive: { backgroundColor: '#211319' },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  playDone: { backgroundColor: palette.success },
  label: { color: palette.text, fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 },
  time: { color: palette.muted, fontFamily: 'Menlo', fontSize: 11, marginTop: 3 },
  state: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, marginTop: 4 },
  stateDone: { color: palette.success },
  badge: { color: palette.rubySoft, backgroundColor: '#2A151B', borderRadius: 99, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 4, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 },
  optional: { color: palette.muted, backgroundColor: palette.panel },
});

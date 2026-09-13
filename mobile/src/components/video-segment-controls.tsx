import { Clock3, Play } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { formatVideoTimestamp, type VideoSegment } from '@/lib/video-segments';

export function VideoSegmentControls({ segments, onSelect }: { segments: VideoSegment[]; onSelect: (segment: VideoSegment) => void }) {
  if (!segments.length) return null;
  return <View accessibilityLabel="Recording sections" style={styles.shell}>
    <View style={styles.header}><View style={styles.icon}><Clock3 color={palette.rubySoft} size={17} /></View><View style={styles.copy}><Text style={styles.title}>Watch the parts that matter</Text><Text style={styles.subtitle}>Tap a section to jump there. The full class recording stays available.</Text></View></View>
    {segments.map((segment) => <Pressable key={`${segment.start_seconds}:${segment.end_seconds}:${segment.label}`} accessibilityRole="button" accessibilityLabel={`Play ${segment.label}, ${formatVideoTimestamp(segment.start_seconds)} to ${formatVideoTimestamp(segment.end_seconds)}`} onPress={() => onSelect(segment)} style={styles.row}><View style={styles.play}><Play color={palette.text} fill={palette.text} size={15} /></View><View style={styles.copy}><Text style={styles.label}>{segment.label}</Text><Text style={styles.time}>{formatVideoTimestamp(segment.start_seconds)}–{formatVideoTimestamp(segment.end_seconds)}</Text></View><Text style={[styles.badge, !segment.required && styles.optional]}>{segment.required ? 'CORE' : 'OPTIONAL'}</Text></Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  shell: { marginTop: 10, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, overflow: 'hidden' },
  header: { minHeight: 68, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 },
  row: { minHeight: 64, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  label: { color: palette.text, fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 },
  time: { color: palette.muted, fontFamily: 'Menlo', fontSize: 11, marginTop: 3 },
  badge: { color: palette.rubySoft, backgroundColor: '#2A151B', borderRadius: 99, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 4, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 },
  optional: { color: palette.muted, backgroundColor: palette.panel },
});

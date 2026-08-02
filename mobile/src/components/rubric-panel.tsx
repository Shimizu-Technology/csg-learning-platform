import { BadgeCheck, CircleDashed } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/csg-theme';
import type { Rubric, RubricRating } from '@/lib/types';

const labels: Record<RubricRating, string> = { exceeds: 'EXCEEDS', meets: 'MEETS', developing: 'DEVELOPING', redo: 'REVISION' };

export function RubricPanel({ rubric }: { rubric?: Rubric | null }) {
  if (!rubric) return null;
  const reviewed = rubric.criteria.some((criterion) => criterion.rating);
  return <View accessibilityLabel={`Rubric: ${rubric.title}`} style={styles.card}>
    <View style={styles.header}><View style={styles.icon}>{reviewed ? <BadgeCheck color={palette.success} size={19} /> : <CircleDashed color={palette.success} size={19} />}</View><View style={styles.flex}><Text style={styles.eyebrow}>{reviewed ? 'YOUR CRITERION FEEDBACK' : 'HOW THIS WORK WILL BE REVIEWED'}</Text><Text style={styles.title}>{rubric.title}</Text>{rubric.description && <Text style={styles.description}>{rubric.description}</Text>}</View></View>
    <View style={styles.criteria}>{rubric.criteria.map((criterion) => <View key={criterion.id} style={styles.criterion}><View style={styles.criterionHeader}><Text style={styles.criterionTitle}>{criterion.title}</Text>{criterion.rating && <Text style={styles.rating}>{labels[criterion.rating]}</Text>}</View><Text style={styles.criterionDescription}>{criterion.description}</Text>{criterion.feedback && <Text style={styles.feedback}>{criterion.feedback}</Text>}</View>)}</View>
  </View>;
}

const styles = StyleSheet.create({ card: { borderRadius: 20, borderWidth: 1, borderColor: '#1E5A43', backgroundColor: '#0E211B', padding: 16, gap: 14 }, header: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' }, icon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#15372A', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, eyebrow: { color: palette.success, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 16, marginTop: 4 }, description: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, criteria: { gap: 9 }, criterion: { borderRadius: 15, borderWidth: 1, borderColor: '#204437', backgroundColor: palette.panel, padding: 12 }, criterionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }, criterionTitle: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, rating: { color: palette.success, backgroundColor: '#15372A', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.extraBold, fontSize: 11 }, criterionDescription: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 }, feedback: { color: '#D7E8DF', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 9, borderLeftWidth: 2, borderLeftColor: palette.success, paddingLeft: 9 } });

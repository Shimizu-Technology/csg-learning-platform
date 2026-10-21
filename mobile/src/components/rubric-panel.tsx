import { makeStyles, useTheme } from '@/providers/theme-provider';
import { BadgeCheck, CircleDashed } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/csg-theme';
import type { Rubric, RubricRating } from '@/lib/types';

const labels: Record<RubricRating, string> = { exceeds: 'EXCEEDS', meets: 'MEETS', developing: 'DEVELOPING', redo: 'REVISION' };

export function RubricPanel({ rubric }: { rubric?: Rubric | null }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  if (!rubric) return null;
  const reviewed = rubric.criteria.some((criterion) => criterion.rating);
  return <View accessibilityLabel={`Rubric: ${rubric.title}`} style={styles.card}>
    <View style={styles.header}><View style={styles.icon}>{reviewed ? <BadgeCheck color={c.status.success.fg} size={19} /> : <CircleDashed color={c.status.success.fg} size={19} />}</View><View style={styles.flex}><Text style={styles.eyebrow}>{reviewed ? 'YOUR CRITERION FEEDBACK' : 'HOW THIS WORK WILL BE REVIEWED'}</Text><Text style={styles.title}>{rubric.title}</Text>{rubric.description && <Text style={styles.description}>{rubric.description}</Text>}</View></View>
    <View style={styles.criteria}>{rubric.criteria.map((criterion) => <View key={criterion.id} style={styles.criterion}><View style={styles.criterionHeader}><Text style={styles.criterionTitle}>{criterion.title}</Text>{criterion.rating && <Text style={styles.rating}>{labels[criterion.rating]}</Text>}</View><Text style={styles.criterionDescription}>{criterion.description}</Text>{criterion.feedback && <Text style={styles.feedback}>{criterion.feedback}</Text>}</View>)}</View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({ card: { borderRadius: 20, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 16, gap: 14 }, header: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' }, icon: { width: 38, height: 38, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, eyebrow: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 16, marginTop: 4 }, description: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }, criteria: { gap: 9 }, criterion: { borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.raised, padding: 12 }, criterionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }, criterionTitle: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, rating: { color: c.status.success.fg, backgroundColor: c.surface.sunken, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.extraBold, fontSize: 12 }, criterionDescription: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 4 }, feedback: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 9, borderLeftWidth: 2, borderLeftColor: c.status.success.fg, paddingLeft: 9 } }));

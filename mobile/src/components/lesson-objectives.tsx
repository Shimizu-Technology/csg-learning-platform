import { CheckCircle2, Target } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';
import type { LessonObjective } from '@/lib/types';

type Props = { objectives?: LessonObjective[] };

export function LessonObjectives({ objectives = [] }: Props) {
  const visible = objectives.filter((objective) => objective.active);
  if (!visible.length) return null;

  return (
    <View accessibilityRole="summary" style={styles.panel}>
      <View style={styles.headingRow}>
        <View style={styles.icon}><Target color={palette.text} size={19} strokeWidth={2.3} /></View>
        <View style={styles.flex}>
          <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>BEFORE YOU BEGIN</Text>
          <Text maxFontSizeMultiplier={fontScaleLimits.title} style={styles.heading}>What success looks like</Text>
        </View>
      </View>
      <View style={styles.list}>
        {visible.map((objective) => (
          <View key={`${objective.id}:${objective.content_block_id || 'lesson'}`} style={styles.item}>
            <CheckCircle2 color={palette.rubySoft} size={19} style={styles.check} />
            <View style={styles.flex}>
              <View style={styles.metaRow}>
                <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.code}>{objective.code}</Text>
                {!!objective.content_block_title && <Text maxFontSizeMultiplier={fontScaleLimits.utility} numberOfLines={1} style={styles.target}>For {objective.content_block_title}</Text>}
              </View>
              <Text maxFontSizeMultiplier={fontScaleLimits.title} style={styles.title}>{objective.title}</Text>
              {!!objective.description && <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.description}>{objective.description}</Text>}
              <View style={styles.criteria}><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.criteriaText}>{objective.success_criteria}</Text></View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 16, borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#191217', padding: 17 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1 },
  heading: { ...typography.title, color: palette.text, fontFamily: fonts.extraBold, marginTop: 2 },
  list: { gap: 9, marginTop: 15 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 13 },
  check: { marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  code: { ...typography.label, color: '#CDD0D8', fontFamily: 'Menlo', backgroundColor: '#24262D', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4, overflow: 'hidden' },
  target: { ...typography.meta, flex: 1, color: palette.muted, fontFamily: fonts.semibold },
  title: { ...typography.body, color: palette.text, fontFamily: fonts.extraBold, marginTop: 8 },
  description: { ...typography.body, color: palette.muted, fontFamily: fonts.regular, marginTop: 4 },
  criteria: { borderLeftWidth: 2, borderLeftColor: '#6A2A36', paddingLeft: 9, marginTop: 8 },
  criteriaText: { ...typography.body, color: '#D9DCE3', fontFamily: fonts.semibold },
});

import { Check, CheckCircle2, RotateCcw } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';

export type GradingOutcome = 'A' | 'B' | 'C' | 'R';

interface GradingReviewActionsProps {
  selected: GradingOutcome | null;
  changed: boolean;
  saving: boolean;
  onSelect: (grade: GradingOutcome) => void;
  onSave: () => void;
}

export function GradingReviewActions({ selected, changed, saving, onSelect, onSave }: GradingReviewActionsProps) {
  const saveLabel = selected === 'R' ? 'Save redo request' : selected ? `Save grade ${selected}` : 'Save review';
  const saveDisabled = saving || !changed || !selected;

  return <View style={styles.container}>
    <Text style={styles.label}>GRADE</Text>
    <Text style={styles.hint}>Choose the outcome, review the feedback, then save once.</Text>
    <View style={styles.gradeRow}>
      {(['A', 'B', 'C'] as GradingOutcome[]).map((grade) => <Pressable
        key={grade}
        accessibilityRole="button"
        accessibilityLabel={`Select grade ${grade}`}
        accessibilityState={{ selected: selected === grade, disabled: saving }}
        disabled={saving}
        onPress={() => onSelect(grade)}
        style={[styles.gradeButton, selected === grade && styles.gradeButtonActive]}
      >
        <Check color={selected === grade ? palette.text : palette.success} size={16} />
        <Text style={styles.gradeButtonText}>{grade}</Text>
      </Pressable>)}
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Request redo"
      accessibilityState={{ selected: selected === 'R', disabled: saving }}
      disabled={saving}
      onPress={() => onSelect('R')}
      style={[styles.redoButton, selected === 'R' && styles.redoButtonActive]}
    >
      <RotateCcw color={palette.warning} size={18} />
      <Text style={styles.redoButtonText}>Request redo</Text>
    </Pressable>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saveLabel}
      accessibilityState={{ disabled: saveDisabled }}
      disabled={saveDisabled}
      onPress={onSave}
      style={[styles.saveReview, saveDisabled && styles.disabled]}
    >
      {saving
        ? <Text style={styles.saveReviewText}>Saving review…</Text>
        : <><CheckCircle2 color={palette.text} size={18} /><Text style={styles.saveReviewText}>{saveLabel}</Text></>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 6 },
  label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.3, marginBottom: 8 },
  hint: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 10 },
  gradeRow: { flexDirection: 'row', gap: 8 },
  gradeButton: { flex: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#1E5A43', backgroundColor: '#10271F', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  gradeButtonActive: { backgroundColor: '#1B684A', borderColor: palette.success },
  gradeButtonText: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 13 },
  redoButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: '#5B4720', backgroundColor: '#2A2115', marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  redoButtonActive: { backgroundColor: '#493718' },
  redoButtonText: { color: palette.warning, fontFamily: fonts.bold, fontSize: 12 },
  saveReview: { minHeight: 54, borderRadius: 16, backgroundColor: palette.ruby, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveReviewText: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 13 },
  disabled: { opacity: 0.42 },
});

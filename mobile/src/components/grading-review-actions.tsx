import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Check, CheckCircle2, RotateCcw } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';

export type GradingOutcome = 'A' | 'B' | 'C' | 'R';

interface GradingReviewActionsProps {
  previousAttempt?: boolean;
  onLatest?: () => void;
  selected: GradingOutcome | null;
  changed: boolean;
  saving: boolean;
  disabled?: boolean;
  saveBlocked?: boolean;
  onSelect: (grade: GradingOutcome) => void;
  onSave: () => void;
}

export function GradingReviewActions({ previousAttempt = false, onLatest, selected, changed, saving, disabled = false, saveBlocked = false, onSelect, onSave }: GradingReviewActionsProps) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  if (previousAttempt) return <View style={styles.container}>
    <Text style={styles.hint}>Previous attempt · read-only. Grade the latest attempt to update progress.</Text>
    <Button variant="secondary" label="Grade the latest attempt" onPress={onLatest} />
  </View>;
  const saveLabel = selected === 'R' ? 'Save redo request' : selected ? `Save grade ${selected}` : 'Save review';
  const controlsDisabled = saving || disabled;
  const saveDisabled = controlsDisabled || saveBlocked || !changed || !selected;

  return <View style={styles.container}>
    <Text style={styles.label}>GRADE</Text>
    <Text style={styles.hint}>Choose the outcome, review the feedback, then save once.</Text>
    <View style={styles.gradeRow}>
      {(['A', 'B', 'C'] as GradingOutcome[]).map((grade) => <Pressable
        key={grade}
        accessibilityRole="button"
        accessibilityLabel={`Select grade ${grade}`}
        accessibilityState={{ selected: selected === grade, disabled: controlsDisabled }}
        disabled={controlsDisabled}
        onPress={() => onSelect(grade)}
        style={[styles.gradeButton, selected === grade && styles.gradeButtonActive, controlsDisabled && styles.disabled]}
      >
        {selected === grade && <Check color={c.selection.indicator} size={16} />}
        <Text style={styles.gradeButtonText}>{grade}</Text>
      </Pressable>)}
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Request redo"
      accessibilityState={{ selected: selected === 'R', disabled: controlsDisabled }}
      disabled={controlsDisabled}
      onPress={() => onSelect('R')}
      style={[styles.redoButton, selected === 'R' && styles.redoButtonActive, controlsDisabled && styles.disabled]}
    >
      <RotateCcw color={c.status.warning.fg} size={18} />
      <Text style={styles.redoButtonText}>Request redo</Text>
    </Pressable>
    <Button variant="primary"
      accessibilityRole="button"
      accessibilityLabel={saveLabel}
      accessibilityState={{ disabled: saveDisabled }}
      disabled={saveDisabled}
      onPress={onSave}
      style={[styles.saveReview, saveDisabled && styles.disabled]}
    >
      {saving
        ? <Text style={styles.saveReviewText}>Saving review…</Text>
        : <><CheckCircle2 color={c.text.strong} size={18} /><Text style={styles.saveReviewText}>{saveLabel}</Text></>}
    </Button>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  container: { marginTop: 6 },
  label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3, marginBottom: 8 },
  hint: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 10 },
  gradeRow: { flexDirection: 'row', gap: 8 },
  gradeButton: { flex: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  gradeButtonActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 },
  gradeButtonText: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 13 },
  redoButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  redoButtonActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 },
  redoButtonText: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 12 },
  saveReview: { minHeight: 54, borderRadius: 16,  marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveReviewText: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 13 },
  disabled: { opacity: 0.42 },
}));

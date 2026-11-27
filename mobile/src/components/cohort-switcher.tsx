import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { Check, ChevronDown, GraduationCap, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
import type { AccessibleCohort } from '@/lib/types';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';

function sectionFor(cohort: AccessibleCohort) {
  if (cohort.cohort_type === 'alumni') return 'Alumni';
  if (cohort.status === 'completed' || cohort.status === 'archived' || cohort.enrollment_status === 'completed') return 'Past learning';
  return 'Current';
}

export function CohortSwitcher({ showHomeLink = true, navigateOnSelect = false, compact = false }: { showHomeLink?: boolean; navigateOnSelect?: boolean; compact?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { cohorts, selectedCohortId, selectedCohort, loading, error, refresh, selectCohort } = useCohort();
  const [open, setOpen] = useState(false);
  const label = (selectedCohort ? selectedCohort.name + (selectedCohort.enrollment_status === 'paused' ? ' · Paused' : '') : null) ?? (user?.is_admin ? 'All cohorts' : loading ? 'Loading cohorts' : 'Choose cohort');
  const groups = ['Current', 'Alumni', 'Past learning'] as const;
  const openHome = (cohortId: number) => {
    setOpen(false);
    const href = { pathname: '/cohort/[id]' as const, params: { id: String(cohortId) } };
    if (navigateOnSelect) router.replace(href);
    else router.push(href);
  };
  const choose = (cohortId: number) => {
    if (cohortId !== selectedCohortId) haptic('selection');
    void selectCohort(cohortId);
    setOpen(false);
    if (navigateOnSelect) openHome(cohortId);
  };

  return <>
    <View style={[styles.bar, compact && styles.barCompact]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Current cohort: ${label}. Switch cohort`} onPress={() => setOpen(true)} style={[styles.selector, compact && styles.selectorCompact]}>
        <View style={[styles.mark, compact && styles.markCompact]}><Users color={c.text.body} size={compact ? 16 : 18} /></View>
        <View style={styles.flex}>{!compact && <Text style={styles.kicker}>Cohort</Text>}<Text numberOfLines={1} style={styles.name}>{label}</Text></View>
        <ChevronDown color={c.text.muted} size={18} />
      </Pressable>
      {showHomeLink && selectedCohort && <Pressable accessibilityRole="button" accessibilityLabel={`Open ${selectedCohort.name} home`} onPress={() => openHome(selectedCohort.id)} style={[styles.home, compact && styles.homeCompact]}><Text style={styles.homeLabel}>My cohort</Text></Pressable>}
    </View>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close cohort switcher" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}><View style={styles.flex}><Text style={styles.sheetTitle}>Your cohorts</Text><Text style={styles.sheetCopy}>Choose a class to focus Today, Learn, and grading.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={styles.close}><X color={c.text.body} size={20} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.list}>
            {user?.is_admin && <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedCohortId === null }} onPress={() => { if (selectedCohortId !== null) haptic('selection'); void selectCohort(null); setOpen(false); if (navigateOnSelect) router.replace('/'); }} style={[styles.option, selectedCohortId === null && styles.selected]}><View style={styles.optionIcon}><Users color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.optionTitle}>All cohorts</Text><Text style={styles.optionCopy}>School-wide attention and activity</Text></View>{selectedCohortId === null && <Check color={c.selection.indicator} size={18} />}</Pressable>}
            {error && <Button accessibilityRole="button" onPress={() => void refresh()} style={styles.retry} variant="secondary" label="Cohorts could not refresh. Tap to retry." textStyle={styles.retryText} />}
            {groups.map((group) => {
              const items = cohorts.filter((cohort) => sectionFor(cohort) === group);
              return items.length ? <View key={group} style={styles.group}><Text style={styles.groupLabel}>{group}</Text>{items.map((cohort) => <View key={cohort.id} style={[styles.option, cohort.id === selectedCohortId && styles.selected]}><Pressable accessibilityRole="button" accessibilityLabel={`Select ${cohort.name}${cohort.enrollment_status === 'paused' ? ' · Paused' : ''}`} accessibilityState={{ selected: cohort.id === selectedCohortId }} onPress={() => choose(cohort.id)} style={styles.optionMain}><View style={styles.optionIcon}>{group === 'Alumni' ? <GraduationCap color={c.text.body} size={19} /> : <Users color={c.text.body} size={19} />}</View><View style={styles.flex}><Text numberOfLines={1} style={styles.optionTitle}>{cohort.name}{cohort.enrollment_status === 'paused' ? ' · Paused' : ''}</Text><Text numberOfLines={1} style={styles.optionCopy}>{cohort.curriculum_name}{group === 'Past learning' ? ' · Past' : ''}</Text></View>{cohort.id === selectedCohortId && <Check color={c.selection.indicator} size={18} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Open ${cohort.name} home`} onPress={() => { void selectCohort(cohort.id); openHome(cohort.id); }} style={styles.optionOpen}><Text style={styles.optionOpenText}>Open</Text></Pressable></View>)}</View> : null;
            })}
            {!loading && cohorts.length === 0 && <Text style={styles.empty}>Your cohorts will appear here when you have access.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const useStyles = makeStyles(({ colors: c, radius, shadow }) => StyleSheet.create({
  bar: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  barCompact: { flex: 1, marginBottom: 0 },
  selector: { flex: 1, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle, backgroundColor: c.surface.raised, ...shadow.raised },
  selectorCompact: { minHeight: 44, borderRadius: radius.control, paddingHorizontal: 10, gap: 8 },
  mark: { width: 34, height: 34, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  markCompact: { width: 28, height: 28, borderRadius: radius.sm },
  flex: { flex: 1, minWidth: 0 },
  kicker: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
  name: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
  home: { minWidth: 48, paddingHorizontal: 10, minHeight: 54, borderRadius: radius.card, backgroundColor: c.surface.raised, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle, ...shadow.raised },
  homeCompact: { minHeight: 44, borderRadius: radius.control },
  homeLabel: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '82%', backgroundColor: c.surface.raised, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.strong, alignSelf: 'center', marginTop: 10 },
  sheetHeader: { flexDirection: 'row', padding: 20, paddingBottom: 14, gap: 10, alignItems: 'center' },
  sheetTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.4 },
  sheetCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 3 },
  close: { minWidth: 44, paddingHorizontal: 8, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 18, paddingBottom: 42, gap: 8 },
  group: { gap: 8, marginTop: 14 },
  groupLabel: { color: c.text.muted, fontFamily: fonts.bold, fontSize: 12, marginBottom: 2 },
  option: { minHeight: 64, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle, backgroundColor: c.surface.raised, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 11 },
  optionMain: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11 },
  optionIcon: { width: 38, height: 38, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: c.border.strong, borderLeftWidth: 3, borderLeftColor: c.selection.indicator, backgroundColor: c.selection.bg },
  optionTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
  optionCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  optionOpen: { minWidth: 44, paddingHorizontal: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle },
  optionOpenText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
  empty: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingVertical: 25 },
  retry: { borderRadius: radius.control, padding: 12 },
  retryText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 13 },
}));

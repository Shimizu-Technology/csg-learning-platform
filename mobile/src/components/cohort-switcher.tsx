import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { Check, ChevronDown, ChevronRight, GraduationCap, Users, X } from 'lucide-react-native';
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

export function CohortSwitcher({ showHomeLink = true, navigateOnSelect = false }: { showHomeLink?: boolean; navigateOnSelect?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { cohorts, selectedCohortId, selectedCohort, loading, error, refresh, selectCohort } = useCohort();
  const [open, setOpen] = useState(false);
  const label = selectedCohort?.name ?? (user?.is_admin ? 'All cohorts' : loading ? 'Loading cohorts' : 'Choose cohort');
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
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Current cohort: ${label}. Switch cohort`} onPress={() => setOpen(true)} style={styles.selector}>
        <View style={styles.mark}><Users color={c.text.body} size={18} /></View>
        <View style={styles.flex}><Text style={styles.kicker}>COHORT WORKSPACE</Text><Text numberOfLines={1} style={styles.name}>{label}</Text></View>
        <ChevronDown color={c.text.body} size={19} />
      </Pressable>
      {showHomeLink && selectedCohort && <Pressable accessibilityRole="button" accessibilityLabel={`Open ${selectedCohort.name} home`} onPress={() => openHome(selectedCohort.id)} style={styles.home}><ChevronRight color={c.text.body} size={22} /></Pressable>}
    </View>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close cohort switcher" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}><View style={styles.flex}><Text style={styles.sheetTitle}>Your cohorts</Text><Text style={styles.sheetCopy}>Choose a class to focus Today, Learn, and grading.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={styles.close}><X color={c.text.body} size={20} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.list}>
            {user?.is_admin && <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedCohortId === null }} onPress={() => { if (selectedCohortId !== null) haptic('selection'); void selectCohort(null); setOpen(false); if (navigateOnSelect) router.replace('/'); }} style={[styles.option, selectedCohortId === null && styles.selected]}><View style={styles.optionIcon}><Users color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.optionTitle}>All cohorts</Text><Text style={styles.optionCopy}>School-wide attention and activity</Text></View>{selectedCohortId === null && <Check color={c.text.body} size={18} />}</Pressable>}
            {error && <Button accessibilityRole="button" onPress={() => void refresh()} style={styles.retry} variant="secondary" label="Cohorts could not refresh. Tap to retry." textStyle={styles.retryText} />}
            {groups.map((group) => {
              const items = cohorts.filter((cohort) => sectionFor(cohort) === group);
              return items.length ? <View key={group} style={styles.group}><Text style={styles.groupLabel}>{group.toUpperCase()}</Text>{items.map((cohort) => <View key={cohort.id} style={[styles.option, cohort.id === selectedCohortId && styles.selected]}><Pressable accessibilityRole="button" accessibilityLabel={`Select ${cohort.name}`} accessibilityState={{ selected: cohort.id === selectedCohortId }} onPress={() => choose(cohort.id)} style={styles.optionMain}><View style={styles.optionIcon}>{group === 'Alumni' ? <GraduationCap color={c.text.body} size={19} /> : <Users color={c.text.body} size={19} />}</View><View style={styles.flex}><Text numberOfLines={1} style={styles.optionTitle}>{cohort.name}</Text><Text numberOfLines={1} style={styles.optionCopy}>{cohort.curriculum_name}{group === 'Past learning' ? ' · Past' : ''}</Text></View>{cohort.id === selectedCohortId && <Check color={c.text.body} size={18} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Open ${cohort.name} home`} onPress={() => { void selectCohort(cohort.id); openHome(cohort.id); }} style={styles.optionOpen}><ChevronRight color={c.text.body} size={19} /></Pressable></View>)}</View> : null;
            })}
            {!loading && cohorts.length === 0 && <Text style={styles.empty}>Your cohorts will appear here when you have access.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  bar: { flexDirection: 'row', gap: 8, marginBottom: 4 }, selector: { flex: 1, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken }, mark: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, name: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, marginTop: 2 }, home: { width: 48, minHeight: 62, borderRadius: 17, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border.strong },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }, sheet: { maxHeight: '82%', backgroundColor: c.surface.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: c.border.subtle }, handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.subtle, alignSelf: 'center', marginTop: 10 }, sheetHeader: { flexDirection: 'row', padding: 20, gap: 10, alignItems: 'center' }, sheetTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 23 }, sheetCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, list: { paddingHorizontal: 18, paddingBottom: 42, gap: 8 }, group: { gap: 8, marginTop: 16 }, groupLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3, marginBottom: 2 }, option: { minHeight: 68, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 11 }, optionMain: { flex: 1, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11 }, optionIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, selected: { borderColor: c.border.strong, borderLeftWidth: 3, borderLeftColor: c.selection.indicator, backgroundColor: c.selection.bg }, optionTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, optionCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, optionOpen: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: c.border.subtle }, empty: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, paddingVertical: 25 }, retry: { borderRadius: 12, backgroundColor: c.surface.sunken, padding: 12 }, retryText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
}));

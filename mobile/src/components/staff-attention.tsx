import { useRouter, type Href } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { themedAlert as Alert } from '@/lib/alerts';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { useSession } from '@/providers/session-provider';
import { LearningCard, SectionHeading } from './learning-ui';
import { fonts } from '@/constants/csg-theme';
import type { SupportQueueStudent } from '@/lib/types';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export function StaffAttention({ students, limit, cohortId }: { students: SupportQueueStudent[]; limit?: number; cohortId?: number | null }) {
  const router = useRouter();
  const { api } = useSession();
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <View style={styles.section}>
    <SectionHeading title="Needs attention" actionLabel={limit && students.length ? `View all ${students.length}` : undefined} onAction={limit && students.length ? () => router.push(`/staff/support${cohortId ? `?cohort_id=${cohortId}` : ''}` as Href) : undefined} />
    <View style={styles.stack}>{students.length === 0 ? <LearningCard><Text style={styles.title}>Everyone’s on track</Text><Text style={styles.copy}>Checked help requests, latest work, due follow-ups, invitations, assigned learning, and released unfinished work.</Text></LearningCard> : students.slice(0, limit).map((student) => <LearningCard key={student.enrollment_id} onPress={student.next_action ? () => { const action = student.next_action!; if (action.web_handoff) void openAuthenticatedWebPage(api, action.web_path).catch((error) => Alert.alert('Could not open staff tools', (error as Error).message)); else router.push(action.native_path as Href); } : undefined} label={`${student.next_action?.label || 'Open'} · ${student.full_name} · ${student.cohort_name}`}>
      <View style={styles.row}><View style={styles.flex}><Text style={styles.title}>{student.full_name || student.email}</Text><Text style={styles.copy}>{student.cohort_name}</Text>{student.reasons?.map((reason) => <Text key={reason.code} style={styles.reason}>{reason.label}</Text>)}<Text style={styles.copy}>Assigned learning: {student.completed_blocks}/{student.total_blocks} steps · Released unfinished: {student.released_unfinished_blocks ?? 0}</Text><Text style={styles.action}>{student.next_action?.label}</Text></View><ArrowRight color={c.text.muted} size={18} /></View>
    </LearningCard>)}</View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  section: { marginTop: 24 }, stack: { gap: 10, marginTop: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1, minWidth: 0 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 }, copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 5 }, reason: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20, marginTop: 7 }, action: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 12 },
}));

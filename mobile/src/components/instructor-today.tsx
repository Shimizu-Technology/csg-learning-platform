import { useRouter, type Href } from 'expo-router';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  HelpCircle,
  LifeBuoy,
  MessageSquare,
  RotateCcw,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Badge } from './ui/badge';
import { PressableScale as Pressable } from './ui/pressable-scale';
import { fonts, tabularNums } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import type { components } from '@/lib/api.generated';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

const KIND_LABELS: Record<string, string> = {
  help: 'Open help requests',
  review: 'Waiting for review',
  message: 'Unread conversations',
  quiet: 'Going quiet',
  follow_up: 'Follow-ups',
};

const KIND_ICONS: Record<string, LucideIcon> = {
  help: HelpCircle,
  review: ClipboardCheck,
  message: MessageSquare,
  quiet: Clock3,
  follow_up: LifeBuoy,
};

export function InstructorToday({ today, redoCount = 0 }: { redoCount?: number; today: components['schemas']['InstructorToday'] }) {
  const router = useRouter();
  const { api } = useSession();
  const { colors: c } = useTheme();
  const styles = useStyles();
  const total = Object.values(today.counts).reduce((sum, count) => sum + count, 0);

  return (
    <View style={styles.root}>
      <View style={styles.headerBlock}>
        <SectionHeading title="Today" />
        <Text style={styles.subtitle}>
          {total === 1 ? '1 thing needs you' : `${total} things need you`}
        </Text>
      </View>

      {total === 0 && !today.attention_remaining && (
        <LearningCard>
          <View style={styles.caughtUpRow}>
            <View style={styles.successTile}>
              <CheckCircle2 color={c.status.success.fg} size={20} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.strongTitle}>You&apos;re caught up</Text>
              <Text style={styles.body}>Check your cohorts or come back when new work arrives.</Text>
            </View>
          </View>
        </LearningCard>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Redo requests · ${redoCount}`}
        onPress={() => router.push('/(app)/(tabs)/grading?filter=redo')}
        style={styles.redoBar}
      >
        <View style={styles.warningTile}>
          <RotateCcw color={c.status.warning.fg} size={17} />
        </View>
        <Text style={styles.redoLabel}>Redo requests · {redoCount}</Text>
        <ArrowRight color={c.text.muted} size={17} />
      </Pressable>

      {Object.keys(today.counts).length > 0 && (
        <View style={styles.chipWrap}>
          {Object.entries(today.counts).map(([kind, count]) => {
            const Icon = KIND_ICONS[kind] || Users;
            const label = KIND_LABELS[kind] || kind;
            const target = (
              kind === 'review'
                ? '/(app)/(tabs)/grading?filter=ungraded'
                : kind === 'message'
                  ? '/messages'
                  : kind === 'help'
                    ? '/(app)/(tabs)/support?filter=help'
                    : kind === 'follow_up'
                      ? '/(app)/(tabs)/support?filter=follow_up'
                      : '/(app)/(tabs)/support'
            ) as Href;
            return (
              <Pressable
                key={kind}
                accessibilityRole="link"
                haptic="selection"
                style={styles.statChip}
                onPress={() => router.push(target)}
              >
                <Icon color={c.text.body} size={15} />
                <Text style={styles.statChipText}>
                  {label} · {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {today.attention_remaining > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/staff/support' as Href)}
          style={styles.attentionBanner}
        >
          <LifeBuoy color={c.status.warning.fg} size={17} />
          <Text style={styles.attentionText}>
            {today.attention_remaining} more {today.attention_remaining === 1 ? 'learner needs' : 'learners need'} attention → Support
          </Text>
        </Pressable>
      )}

      {today.items.map((item) => {
        const KindIcon = KIND_ICONS[item.kind] || Users;
        return (
          <LearningCard key={`${item.kind}-${item.id}`}>
            <View style={styles.itemHeader}>
              <View style={[styles.itemIcon, item.urgent && styles.urgentTile]}>
                <KindIcon color={item.urgent ? c.status.danger.fg : c.text.body} size={17} />
              </View>
              <View style={styles.flex}>
                <Pressable
                  disabled={item.student_record === false || !item.cohort_id}
                  accessibilityRole={item.student_record === false ? undefined : 'link'}
                  onPress={() => router.push(`/staff/student/${item.user_id}?cohort_id=${item.cohort_id}` as Href)}
                  style={styles.nameHit}
                >
                  <Text style={styles.studentName}>{item.full_name}</Text>
                </Pressable>
                {item.cohort_id && item.cohort_name && (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push(`/cohort/${item.cohort_id}` as Href)}
                    style={styles.cohortHit}
                  >
                    <Text style={styles.cohortName}>{item.cohort_name}</Text>
                  </Pressable>
                )}
              </View>
              {item.urgent && <Badge label="Urgent" tone="danger" />}
            </View>
            <Text numberOfLines={3} style={styles.itemBody}>
              {item.urgent ? 'Urgent · ' : ''}
              {item.text}
            </Text>
            <View style={styles.itemFooter}>
              <Pressable
                accessibilityRole="button"
                style={styles.itemAction}
                onPress={() => {
                  if (item.native_path) router.push(item.native_path as Href);
                  else
                    void api
                      .createCohortDm(item.cohort_id!, [item.user_id])
                      .then((result) => router.push(`/conversation/dm/${result.direct_conversation.id}` as Href))
                      .catch((error) => Alert.alert('Could not open message', String(error)));
                }}
              >
                <Text style={styles.itemActionText}>{item.action_label}</Text>
                <ArrowRight color={c.action.primary} size={16} />
              </Pressable>
            </View>
          </LearningCard>
        );
      })}

      {today.upcoming.length > 0 && (
        <View style={styles.upcomingSection}>
          <SectionHeading title="Upcoming today" />
          <LearningCard>
            <View style={styles.upcomingList}>
              {today.upcoming.map((event, index) => (
                <View key={index} style={[styles.upcomingRow, index > 0 && styles.rowDivider]}>
                  <View style={styles.upcomingIcon}>
                    <CalendarClock color={c.text.body} size={16} />
                  </View>
                  <Text style={styles.upcomingText}>
                    {new Date(event.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {event.title}
                  </Text>
                </View>
              ))}
            </View>
          </LearningCard>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c, radius, shadow }) => StyleSheet.create({
  root: { gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  headerBlock: { gap: 2 },
  subtitle: { ...tabularNums, color: c.text.body, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  caughtUpRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  strongTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 2 },
  successTile: { width: 40, height: 40, borderRadius: radius.control, backgroundColor: c.status.success.bg, alignItems: 'center', justifyContent: 'center' },
  warningTile: { width: 34, height: 34, borderRadius: radius.control, backgroundColor: c.status.warning.bg, alignItems: 'center', justifyContent: 'center' },
  urgentTile: { backgroundColor: c.status.danger.bg },
  redoBar: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadow.raised,
  },
  redoLabel: { ...tabularNums, flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statChip: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    ...shadow.raised,
  },
  statChipText: { ...tabularNums, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
  attentionBanner: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.status.warning.border,
    backgroundColor: c.status.warning.bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attentionText: { ...tabularNums, flex: 1, color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  itemIcon: { width: 38, height: 38, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  nameHit: { minHeight: 26, justifyContent: 'center' },
  studentName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  cohortHit: { minHeight: 22, justifyContent: 'center' },
  cohortName: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 13 },
  itemBody: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  itemFooter: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, paddingTop: 10, marginTop: 2 },
  itemAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemActionText: { color: c.action.primary, fontFamily: fonts.bold, fontSize: 14 },
  upcomingSection: { gap: 10, marginTop: 4 },
  upcomingList: { gap: 2 },
  upcomingRow: { minHeight: 44, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  upcomingIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  upcomingText: { ...tabularNums, flex: 1, color: c.text.strong, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
}));

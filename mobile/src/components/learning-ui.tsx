import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { CalendarClock, Check, CheckCircle2, Circle, CircleDot, Clock3, Lock, LockKeyhole, RotateCcw, type LucideIcon } from 'lucide-react-native';
import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Card } from './ui/card';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { LEARNER_STATUS, type LearnerStatus, type StatusTone } from '@/lib/learning-status';

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const styles = useStyles();
  const clamped = Math.max(0, Math.min(100, value));
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: clamped }} accessibilityLabel={label || 'Progress'}><View style={styles.track}><View style={[styles.fill, { width: `${clamped}%` }]} /></View></View>;
}

export function SectionHeading({ eyebrow, title, action, actionLabel, onAction }: { eyebrow?: string; title: string; action?: ReactNode; actionLabel?: string; onAction?: () => void }) {
  const styles = useStyles();
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.headingRow, fontScale >= 1.5 && styles.headingRowLarge]}><View style={styles.headingCopy}>{eyebrow && <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>{eyebrow}</Text>}<Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.title} style={styles.heading}>{title}</Text></View>{action}{actionLabel && onAction && <Pressable accessibilityRole="button" onPress={onAction} style={styles.headingAction}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.headingActionText}>{actionLabel}</Text></Pressable>}</View>;
}

export function StatusPill({ completed, locked, label }: { completed?: boolean; locked?: boolean; label?: string }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <View style={[styles.pill, completed && styles.pillSuccess, locked && styles.pillLocked]}>{completed ? <Check color={c.status.success.fg} size={12} /> : locked ? <Lock color={c.text.muted} size={12} /> : null}<Text style={[styles.pillText, completed && styles.pillSuccessText]}>{label || (completed ? 'Complete' : locked ? 'Locked' : 'Available')}</Text></View>;
}

const STATUS_ICONS: Record<LearnerStatus, LucideIcon> = {
  done: CheckCircle2,
  awaiting_review: Clock3,
  redo: RotateCcw,
  in_progress: CircleDot,
  // Open work is a neutral empty circle, not an alert.
  open: Circle,
  upcoming: CalendarClock,
  closed: LockKeyhole,
};

export function StatusIcon({ status, size = 16, color }: { status: LearnerStatus; size?: number; color?: string }) {
  const { colors: c } = useTheme();
  const iconColors: Record<StatusTone, string> = { success: c.status.success.fg, pending: c.text.body, warning: c.status.warning.fg, neutral: c.text.body, quiet: c.text.muted };
  const Icon = STATUS_ICONS[status];
  return <Icon color={color || iconColors[LEARNER_STATUS[status].tone]} size={size} />;
}

/** A status chip whose wording, colour, and icon all come from one mapping (CSG family status tokens). */
export function StatusBadge({ status, short = false, testID }: { status: LearnerStatus; short?: boolean; testID?: string }) {
  const styles = useStyles();
  const { statusTones } = useTheme();
  const meta = LEARNER_STATUS[status];
  const tone = statusTones[meta.tone];
  const label = short ? meta.shortLabel : meta.label;
  return <View accessible accessibilityLabel={`Status: ${meta.label}`} testID={testID} style={[styles.badge, { backgroundColor: tone.background, borderColor: tone.border }]}><StatusIcon status={status} size={13} color={tone.text} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={[styles.badgeText, { color: tone.text }]}>{label}</Text></View>;
}

export function LearningCard({ children, onPress, label }: PropsWithChildren<{ onPress?: () => void; label?: string }>) {
  return <Card onPress={onPress} label={label}>{children}</Card>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  track: { height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: c.surface.sunken },
  fill: { height: '100%', borderRadius: 4, backgroundColor: c.action.primary },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headingRowLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  headingCopy: { flex: 1 },
  eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  heading: { ...typography.title, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -0.6 },
  headingAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  headingActionText: { ...typography.label, color: c.text.body, fontFamily: fonts.bold },
  pill: { minHeight: 26, borderRadius: 13, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.subtle },
  pillSuccess: { backgroundColor: c.status.success.bg, borderColor: c.status.success.border },
  pillLocked: { backgroundColor: c.surface.raised },
  pillText: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  pillSuccessText: { color: c.status.success.fg },
  badge: { minHeight: 26, maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 13, borderWidth: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { ...typography.label, flexShrink: 1, fontFamily: fonts.bold, fontSize: 12 },
  card: { borderRadius: 20, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 16 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
}));

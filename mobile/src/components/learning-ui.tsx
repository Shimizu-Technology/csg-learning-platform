import { CalendarClock, Check, CheckCircle2, Circle, CircleDot, Clock3, Lock, LockKeyhole, RotateCcw, type LucideIcon } from 'lucide-react-native';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontScaleLimits, fonts, palette, statusTones, typography } from '@/constants/csg-theme';
import { LEARNER_STATUS, type LearnerStatus } from '@/lib/learning-status';

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: clamped }} accessibilityLabel={label || 'Progress'}><View style={styles.track}><View style={[styles.fill, { width: `${clamped}%` }]} /></View></View>;
}

export function SectionHeading({ eyebrow, title, action, actionLabel, onAction }: { eyebrow?: string; title: string; action?: ReactNode; actionLabel?: string; onAction?: () => void }) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.headingRow, fontScale >= 1.5 && styles.headingRowLarge]}><View style={styles.headingCopy}>{eyebrow && <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>{eyebrow}</Text>}<Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.title} style={styles.heading}>{title}</Text></View>{action}{actionLabel && onAction && <Pressable accessibilityRole="button" onPress={onAction} style={styles.headingAction}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.headingActionText}>{actionLabel}</Text></Pressable>}</View>;
}

export function StatusPill({ completed, locked, label }: { completed?: boolean; locked?: boolean; label?: string }) {
  return <View style={[styles.pill, completed && styles.pillSuccess, locked && styles.pillLocked]}>{completed ? <Check color={palette.success} size={12} /> : locked ? <Lock color={palette.quiet} size={12} /> : null}<Text style={[styles.pillText, completed && styles.pillSuccessText]}>{label || (completed ? 'Complete' : locked ? 'Locked' : 'Available')}</Text></View>;
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
  const Icon = STATUS_ICONS[status];
  return <Icon color={color || statusTones[LEARNER_STATUS[status].tone].text} size={size} />;
}

/** A status chip whose wording, colour, and icon all come from one mapping (CSG family status tokens). */
export function StatusBadge({ status, short = false, testID }: { status: LearnerStatus; short?: boolean; testID?: string }) {
  const meta = LEARNER_STATUS[status];
  const tone = statusTones[meta.tone];
  const label = short ? meta.shortLabel : meta.label;
  return <View accessible accessibilityLabel={`Status: ${meta.label}`} testID={testID} style={[styles.badge, { backgroundColor: tone.background, borderColor: tone.border }]}><StatusIcon status={status} size={13} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} numberOfLines={1} style={[styles.badgeText, { color: tone.text }]}>{label}</Text></View>;
}

export function LearningCard({ children, onPress, label }: PropsWithChildren<{ onPress?: () => void; label?: string }>) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>{children}</Pressable>;
}

const styles = StyleSheet.create({
  track: { height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: '#272D39' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: palette.ruby },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headingRowLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  headingCopy: { flex: 1 },
  eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  heading: { ...typography.title, color: palette.text, fontFamily: fonts.extraBold, letterSpacing: -0.6 },
  headingAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  headingActionText: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold },
  pill: { minHeight: 26, borderRadius: 13, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#242A36', borderWidth: 1, borderColor: palette.line },
  pillSuccess: { backgroundColor: '#10271F', borderColor: '#1E5A43' },
  pillLocked: { backgroundColor: palette.panel },
  pillText: { ...typography.label, color: palette.muted, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  pillSuccessText: { color: '#73D7A7' },
  badge: { minHeight: 26, maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 13, borderWidth: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { ...typography.label, flexShrink: 1, fontFamily: fonts.bold, fontSize: 12 },
  card: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 16 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
});

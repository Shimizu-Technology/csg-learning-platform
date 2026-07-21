import { Check, Lock } from 'lucide-react-native';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: clamped }} accessibilityLabel={label || 'Progress'}><View style={styles.track}><View style={[styles.fill, { width: `${clamped}%` }]} /></View></View>;
}

export function SectionHeading({ eyebrow, title, action, actionLabel, onAction }: { eyebrow?: string; title: string; action?: ReactNode; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.headingRow}><View style={styles.headingCopy}>{eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}<Text style={styles.heading}>{title}</Text></View>{action}{actionLabel && onAction && <Pressable accessibilityRole="button" onPress={onAction} style={styles.headingAction}><Text style={styles.headingActionText}>{actionLabel}</Text></Pressable>}</View>;
}

export function StatusPill({ completed, locked, label }: { completed?: boolean; locked?: boolean; label?: string }) {
  return <View style={[styles.pill, completed && styles.pillSuccess, locked && styles.pillLocked]}>{completed ? <Check color={palette.success} size={12} /> : locked ? <Lock color={palette.quiet} size={12} /> : null}<Text style={[styles.pillText, completed && styles.pillSuccessText]}>{label || (completed ? 'Complete' : locked ? 'Locked' : 'Available')}</Text></View>;
}

export function LearningCard({ children, onPress, label }: PropsWithChildren<{ onPress?: () => void; label?: string }>) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>{children}</Pressable>;
}

const styles = StyleSheet.create({
  track: { height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: '#272D39' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: palette.ruby },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.6 },
  headingAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  headingActionText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10 },
  pill: { minHeight: 26, borderRadius: 13, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#242A36', borderWidth: 1, borderColor: palette.line },
  pillSuccess: { backgroundColor: '#10271F', borderColor: '#1E5A43' },
  pillLocked: { backgroundColor: palette.panel },
  pillText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  pillSuccessText: { color: '#73D7A7' },
  card: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 16 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
});

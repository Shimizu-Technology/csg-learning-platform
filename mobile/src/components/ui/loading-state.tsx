import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SkeletonCard } from '@/components/ui/skeleton';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export function LoadingState({
  label = 'Loading conversations',
  variant = 'spinner',
}: {
  label?: string;
  variant?: 'spinner' | 'skeleton';
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  if (variant === 'skeleton') {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.skeletonRoot}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.root}>
      <ActivityIndicator color={c.text.body} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  root: { paddingVertical: 64, paddingHorizontal: 24, alignItems: 'center', gap: 12 },
  skeletonRoot: { paddingHorizontal: 16, paddingTop: 20, gap: 12 },
  label: { ...typography.body, color: c.text.body, fontFamily: fonts.regular, textAlign: 'center' },
}));

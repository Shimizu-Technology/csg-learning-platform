import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { makeStyles } from '@/providers/theme-provider';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Subtle Reanimated opacity pulse on the UI thread.
 * Honors OS reduced-motion and stays static in test runs.
 */
export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    if (reducedMotion || process.env.NODE_ENV === 'test') {
      opacity.value = 0.65;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible={false}
      style={[styles.block, { width, height, borderRadius }, animatedStyle, style]}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Skeleton width="38%" height={12} borderRadius={6} />
      <Skeleton width="78%" height={18} borderRadius={8} />
      {lines >= 2 && <Skeleton width="92%" height={13} borderRadius={6} />}
      {lines >= 3 && <Skeleton width="62%" height={13} borderRadius={6} />}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  block: {
    backgroundColor: c.surface.sunken,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    padding: 16,
    gap: 10,
  },
}));

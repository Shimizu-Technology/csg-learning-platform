import { makeStyles } from '@/providers/theme-provider';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import { typingIndicatorLabel, type TypingUser } from '@/lib/typing';

export function TypingIndicator({ users }: { users: TypingUser[] }) {
  const styles = useStyles();
  const label = typingIndicatorLabel(users);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [dots] = useState(() => [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(Boolean(enabled));
    }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      if (mounted) setReduceMotion(Boolean(enabled));
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios' && label) AccessibilityInfo.announceForAccessibility(label);
  }, [label]);

  useEffect(() => {
    if (!label || reduceMotion) {
      dots.forEach((value) => value.setValue(0));
      return;
    }
    const animations = dots.map((value, index) => Animated.loop(
      Animated.sequence([
        Animated.delay(index * 160),
        Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 280, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        Animated.delay(Math.max(0, 480 - index * 160)),
      ]),
    ));
    animations.forEach((anim) => anim.start());
    return () => {
      animations.forEach((anim) => anim.stop());
    };
  }, [dots, label, reduceMotion]);

  if (!label) return null;

  return (
    <View accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
        {dots.map((value, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              !reduceMotion && {
                opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
              },
            ]}
          />
        ))}
      </View>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.text}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  row: { minHeight: 28, paddingHorizontal: 16, backgroundColor: c.surface.raised, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.text.muted },
  text: { flex: 1, color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
}));

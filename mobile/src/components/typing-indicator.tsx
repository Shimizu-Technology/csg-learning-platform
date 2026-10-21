import { makeStyles } from '@/providers/theme-provider';
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import { typingIndicatorLabel, type TypingUser } from '@/lib/typing';

export function TypingIndicator({ users }: { users: TypingUser[] }) {
  const styles = useStyles();
  const label = typingIndicatorLabel(users);

  useEffect(() => {
    if (Platform.OS === 'ios' && label) AccessibilityInfo.announceForAccessibility(label);
  }, [label]);

  if (!label) return null;

  return (
    <View accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.text}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  row: { minHeight: 28, paddingHorizontal: 16, backgroundColor: c.surface.raised, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.text.muted },
  text: { flex: 1, color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
}));

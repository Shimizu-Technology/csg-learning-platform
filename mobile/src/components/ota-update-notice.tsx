import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { fonts, typography } from '@/constants/csg-theme';
import { useOtaUpdates } from '@/hooks/use-ota-updates';
import { brand } from '@/lib/brand';
import { makeStyles } from '@/providers/theme-provider';

/** Nonmodal notice; dismissing it never restarts or navigates away from work. */
export function OtaUpdateNotice() {
  const ready = useOtaUpdates();
  const [dismissed, setDismissed] = useState(false);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  if (!ready || dismissed) return null;

  return <View testID="ota-update-overlay" pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 8, left: insets.left + 12, right: insets.right + 12 }]}>
    <View accessibilityLiveRegion="polite" style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Update ready</Text>
      <Text style={styles.copy}>Finish any message, upload or submission first. {Platform.OS === 'ios' ? `Swipe ${brand.productName} away in the app switcher, then reopen it.` : `Close ${brand.productName} from recent apps, then reopen it.`}</Text>
      <Button label="Later" variant="quiet" onPress={() => setDismissed(true)} />
    </View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  overlay: { position: 'absolute', zIndex: 10 },
  content: { backgroundColor: c.surface.raised, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 4, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 16 },
  title: { ...typography.body, fontFamily: fonts.bold, color: c.text.strong },
  copy: { ...typography.support, fontFamily: fonts.regular, color: c.text.body },
}));

import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { fonts, typography } from '@/constants/csg-theme';
import { useOtaUpdates } from '@/hooks/use-ota-updates';
import * as Updates from 'expo-updates';
import { themedAlert as Alert } from '@/lib/alerts';
import { brand } from '@/lib/brand';
import { makeStyles } from '@/providers/theme-provider';

const OtaReady = createContext(false);

export function OtaUpdateProvider({ children }: PropsWithChildren) {
  const ready = useOtaUpdates();
  return <OtaReady.Provider value={ready}><Notice ready={ready} />{children}</OtaReady.Provider>;
}

export function OtaRestartRow() {
  const ready = useContext(OtaReady);
  if (!ready) return null;
  return <Button variant="secondary" label="Update ready — tap to restart" onPress={() => Alert.alert('Restart to update?', 'Finish any message, upload or submission first.', [
    { text: 'Later', style: 'cancel' },
    { text: 'Restart', onPress: () => void Updates.reloadAsync().catch(() => Alert.alert('Could not restart', 'Close and reopen the app to finish updating.')) },
  ])} />;
}

export function OtaUpdateNotice() {
  const ready = useOtaUpdates();
  return <Notice ready={ready} />;
}

/** Nonmodal notice; dismissing it never restarts or navigates away from work. */
function Notice({ ready }: { ready: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  if (!ready || dismissed) return null;

  return <View testID="ota-update-overlay" style={[styles.overlay, { marginTop: insets.top + 8, marginLeft: insets.left + 12, marginRight: insets.right + 12 }]}>
    <View accessibilityLiveRegion="polite" style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Update ready</Text>
      <Text style={styles.copy}>Finish any message, upload or submission first. {Platform.OS === 'ios' ? `Swipe ${brand.productName} away in the app switcher, then reopen it.` : `Close ${brand.productName} from recent apps, then reopen it.`}</Text>
      <Button label="Later" variant="quiet" onPress={() => setDismissed(true)} />
    </View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  overlay: { marginBottom: 8 },
  content: { backgroundColor: c.surface.raised, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 4, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 16 },
  title: { ...typography.body, fontFamily: fonts.bold, color: c.text.strong },
  copy: { ...typography.support, fontFamily: fonts.regular, color: c.text.body },
}));

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { fonts, typography } from '@/constants/csg-theme';
import { useOtaUpdates } from '@/hooks/use-ota-updates';
import { makeStyles } from '@/providers/theme-provider';

/** Nonmodal notice; dismissing it never restarts or navigates away from work. */
export function OtaUpdateNotice() {
  const ready = useOtaUpdates();
  const [dismissed, setDismissed] = useState(false);
  const styles = useStyles();
  if (!ready || dismissed) return null;

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Update ready — restart</Text>
      <Text style={styles.copy}>Finish any message or submission, then close and reopen CSG Learn to apply the update.</Text>
      <Button label="Later" variant="quiet" onPress={() => setDismissed(true)} />
    </View>
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { backgroundColor: c.surface.raised },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 4, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  title: { ...typography.body, fontFamily: fonts.bold, color: c.text.strong },
  copy: { ...typography.support, fontFamily: fonts.regular, color: c.text.body },
}));

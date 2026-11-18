import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { ErrorState } from '@/components/screen-states';
import { makeStyles } from '@/providers/theme-provider';

/** A learner who reaches a staff screen always has Back and a way to the tabs. */
export function StaffOnlyScreen({ message, exitLabel = 'Go to Today', exitHref = '/' }: { message: string; exitLabel?: string; exitHref?: Href }) {
  const styles = useStyles();
  const router = useRouter();
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.backRow}><BackButton /></View>
    <ErrorState title="Staff access only" message={message} retryLabel={exitLabel} retry={() => router.replace(exitHref)} />
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' },
}));

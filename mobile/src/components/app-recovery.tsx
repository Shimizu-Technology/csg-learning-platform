import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppErrorBoundary } from './app-error-boundary';
import { OtaUpdateNotice } from './ota-update-notice';

/** Keep rollback downloads alive even when an app screen cannot render. */
export function AppRecovery({ children }: PropsWithChildren) {
  return <View style={styles.root}>
    <AppErrorBoundary>{children}</AppErrorBoundary>
    <OtaUpdateNotice />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1 } });

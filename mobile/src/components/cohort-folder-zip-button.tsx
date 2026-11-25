import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Sharing from 'expo-sharing';

import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { useSession } from '@/providers/session-provider';
import { makeStyles } from '@/providers/theme-provider';

/**
 * Exports a folder as one ZIP and opens the share sheet to save or send it:
 * a learner's My files, the class files, or one student's folder (staff).
 * The archive downloads with the session token; nothing is cached for reuse.
 */
export function CohortFolderZipButton({ cohortId, scope, studentId, empty, label = 'Export ZIP', accessibilityLabel, style }: {
  cohortId: number
  scope: 'my_files' | 'class' | 'student'
  studentId?: number
  empty: boolean
  label?: string
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}) {
  const styles = useStyles();
  const { api } = useSession();
  const busy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function exportZip() {
    if (busy.current) return;
    busy.current = true;
    setExporting(true);
    setError(null);
    try {
      const archive = await api.exportCohortFilesZip(cohortId, { scope, studentId });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(archive.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: archive.filename });
    } catch (failure) {
      setError((failure as Error).message || 'Could not export these files.');
    } finally {
      busy.current = false;
      setExporting(false);
    }
  }
  return <View style={[styles.wrap, style]}>
    <Button variant="secondary" accessibilityLabel={accessibilityLabel || label} label={exporting ? 'Preparing ZIP…' : label} loading={exporting} disabled={empty || exporting} onPress={() => void exportZip()} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  wrap: { gap: 6 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13 },
}));

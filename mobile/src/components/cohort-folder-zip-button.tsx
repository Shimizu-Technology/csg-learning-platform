import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Sharing from 'expo-sharing';

import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { useSession } from '@/providers/session-provider';
import { makeStyles } from '@/providers/theme-provider';

/**
 * Exports a folder as one ZIP and opens the share sheet to save or send it:
 * a learner's My files, the class files, or one student's folder (staff).
 * The archive downloads with the session token into its own temporary
 * directory. iOS removes it once the share sheet closes; Android retains a
 * shared archive briefly so the recipient app can open the shared URI, then
 * expires it on later exports, session refresh, or sign-out.
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
  const mounted = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  async function exportZip() {
    if (busy.current) return;
    busy.current = true;
    setExporting(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    let directory: string | null = null;
    let shared = false;
    try {
      const archive = await api.exportCohortFilesZip(cohortId, { scope, studentId, signal: controller.signal });
      directory = archive.directory;
      if (!mounted.current) return;
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(archive.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: archive.filename });
      shared = true;
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message || 'Could not export these files.');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      // On Android, shareAsync resolves when the chooser launches the recipient;
      // keep successful shares until age-expiry or sign-out so the recipient can read the URI.
      if (directory && (!shared || Platform.OS !== 'android')) await api.discardCohortFilesZip(directory);
      busy.current = false;
      if (mounted.current) setExporting(false);
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

import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { FileText } from 'lucide-react-native';

import { LearningCard } from '@/components/learning-ui';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { cohortFileMeta, type CohortFile } from '@/lib/cohort-files';
import { safeExternalUrl } from '@/lib/learning';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

/** A class or private-folder file with a 1-tap download. The signed link is requested per tap and never stored. */
export function CohortFileCard({ cohortId, file, note, onDelete, downloadDisabled = false }: { cohortId: number; file: CohortFile; note?: string; onDelete?: () => void; downloadDisabled?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { api } = useSession();
  const busy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy.current) return;
    busy.current = true;
    setPreparing(true);
    setError(null);
    try {
      const result = await api.downloadCohortFile(cohortId, file.id);
      const url = safeExternalUrl(result.url);
      if (!url) throw new Error('The download link is unavailable. Try again.');
      await Linking.openURL(url);
    } catch (failure) {
      setError((failure as Error).message || 'Could not prepare the download.');
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }

  return <LearningCard>
    <View style={styles.heading}><FileText color={c.text.body} size={20} /><Text style={styles.title}>{file.title}</Text></View>
    <Text style={styles.meta}>{cohortFileMeta(file)}{note ? ` · ${note}` : ''}</Text>
    {file.description && <Text style={styles.meta}>{file.description}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {downloadDisabled && <Text style={styles.meta}>Downloads are unavailable until file storage is set up.</Text>}
    <View style={styles.actions}>
      <Button style={styles.action} variant="secondary" accessibilityLabel={`Download ${file.title}`} label={preparing ? 'Preparing download…' : error ? 'Retry download' : 'Download'} loading={preparing} disabled={preparing || downloadDisabled} onPress={() => void download()} />
      {onDelete && <Button style={styles.action} variant="danger" accessibilityLabel={`Delete ${file.title}`} label="Delete" onPress={onDelete} />}
    </View>
  </LearningCard>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 8 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { flexGrow: 1, minWidth: 130 },
}));

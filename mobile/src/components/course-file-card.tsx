import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Download } from 'lucide-react-native';

import { LearningCard } from '@/components/learning-ui';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { safeExternalUrl } from '@/lib/learning';
import type { LearningResource } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export function CourseFileCard({ resource }: { resource: LearningResource }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { api } = useSession();
  const busy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy.current || !resource.curriculum_id || !resource.download_id) return;
    busy.current = true;
    setPreparing(true);
    setError(null);
    try {
      // Signed URLs are deliberately requested per tap and never kept in query storage.
      const result = await api.downloadCurriculumResource(resource.curriculum_id, resource.download_id);
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
    <View style={styles.heading}><Download color={c.text.body} size={20} /><Text style={styles.title}>{resource.title}</Text></View>
    <Text style={styles.meta}>{resource.filename || 'Course ZIP'} · {formatFileSize(resource.file_size)}</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Button variant="secondary" label={preparing ? 'Preparing download…' : error ? 'Retry download' : 'Download ZIP'} loading={preparing} disabled={preparing} onPress={() => void download()} />
  </LearningCard>;
}

function formatFileSize(bytes?: number) {
  if (bytes == null) return 'Size unavailable';
  return bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginVertical: 12 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13, marginBottom: 12 },
}));

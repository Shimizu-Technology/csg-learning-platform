import { useMutation, useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import type { RecordingItem } from '@/lib/types';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';

/** The cohort list is staff-scoped by the API; publication rechecks permission on save. */
export function RecordingPublishPanel({ item, onPublished }: { item: RecordingItem; onPublished: (recording: RecordingItem) => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { api, user } = useSession();
  const cohorts = useQuery({
    queryKey: ['recording-management-cohorts', user?.id],
    queryFn: ({ signal }) => api.cohorts(signal),
    enabled: Boolean(user?.is_staff),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!user?.is_staff || !cohorts.data?.cohorts.some((cohort) => cohort.id === item.cohort_id) || typeof item.id !== 'number') throw new Error('You cannot publish recordings for this cohort.');
      const response = await api.publishRecording(item.cohort_id, item.id);
      if (response.recording.status !== 'published') throw new Error('Publication was not confirmed. Try again.');
      return response.recording;
    },
    onSuccess: onPublished,
  });

  if (!user?.is_staff || item.status !== 'draft' || typeof item.id !== 'number') return null;
  return <View style={styles.panel}>
    <Text style={styles.title}>Review and publish</Text>
    <Text style={styles.copy}>This draft is private. Check the video, title, and class above before making it available to students in {item.cohort_name}.</Text>
    {cohorts.isPending ? <Text style={styles.copy}>Checking publishing access…</Text> : cohorts.isError ? <><Text accessibilityRole="alert" style={styles.error}>Could not check publishing access.</Text><Pressable accessibilityRole="button" onPress={() => void cohorts.refetch()} style={styles.button}><Text style={styles.buttonText}>Retry access check</Text></Pressable></> : cohorts.data?.cohorts.some((cohort) => cohort.id === item.cohort_id) ? <>
      {publish.error && <Text accessibilityRole="alert" style={styles.error}>Could not publish: {publish.error.message} This recording remains a private draft.</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Publish recording" accessibilityState={{ disabled: publish.isPending }} disabled={publish.isPending} onPress={() => publish.mutate()} style={styles.button}>
        {publish.isPending && <ActivityIndicator color={c.text.strong} />}<Text style={styles.buttonText}>{publish.isPending ? 'Publishing…' : 'Publish recording'}</Text>
      </Pressable>
    </> : <Text style={styles.copy}>Only an admin or an instructor assigned to this cohort can publish this recording.</Text>}
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  panel: { borderRadius: 16, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.raised, padding: 16, gap: 12 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 },
  copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13, lineHeight: 20 },
  button: { minHeight: 48, borderRadius: 12, padding: 12, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  buttonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
}));

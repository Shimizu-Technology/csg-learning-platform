import { useState } from 'react';
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
  const [uncertain, setUncertain] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const checkStatus = async () => {
    const response = await api.recordings(undefined, item.cohort_id);
    const saved = response.items.find((recording) => recording.id === item.id && recording.cohort_id === item.cohort_id);
    if (!saved) throw new Error('Recording status is unavailable.');
    return saved;
  };
  const publish = useMutation({
    mutationFn: async () => {
      if (!user?.is_staff || !cohorts.data?.cohorts.some((cohort) => cohort.id === item.cohort_id) || typeof item.id !== 'number') throw new Error('You cannot publish recordings for this cohort.');
      setStatusMessage(null);
      if (uncertain) {
        try { return await checkStatus(); }
        catch { throw new Error('Publication could not be confirmed. Check status before trying again.'); }
      }
      try {
        const response = await api.publishRecording(item.cohort_id, item.id);
        if (response.recording.status !== 'published') throw new Error('Publication was not confirmed.');
        return response.recording;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status && [400, 401, 403, 404, 409, 422].includes(status)) throw new Error(`Could not publish: ${(error as Error).message} This recording remains a private draft.`);
        setUncertain(true);
        // A timeout can arrive after the server committed the publication.
        // Reconcile before claiming privacy or offering another write.
        try {
          const saved = await checkStatus();
          if (saved.status === 'published') return saved;
        } catch { /* Keep the unknown outcome visible until a status check succeeds. */ }
        throw new Error('Publication could not be confirmed. Check status before trying again.');
      }
    },
    onSuccess: (recording) => {
      setUncertain(false);
      if (recording.status === 'published') onPublished(recording);
      else setStatusMessage('Latest saved status: Draft. You can try publishing again.');
    },
  });

  if (!user?.is_staff || item.status !== 'draft' || typeof item.id !== 'number') return null;
  return <View style={styles.panel}>
    <Text style={styles.title}>Review and publish</Text>
    <Text style={styles.copy}>This draft is private. Check the video, title, and class above before making it available to students in {item.cohort_name}.</Text>
    {cohorts.isPending ? <Text style={styles.copy}>Checking publishing access…</Text> : cohorts.isError ? <><Text accessibilityRole="alert" style={styles.error}>Could not check publishing access.</Text><Pressable accessibilityRole="button" onPress={() => void cohorts.refetch()} style={styles.button}><Text style={styles.buttonText}>Retry access check</Text></Pressable></> : cohorts.data?.cohorts.some((cohort) => cohort.id === item.cohort_id) ? <>
      {publish.error && <Text accessibilityRole="alert" style={styles.error}>{publish.error.message}</Text>}
      {statusMessage && <Text accessibilityLiveRegion="polite" style={styles.copy}>{statusMessage}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={uncertain ? "Check publication status" : "Publish recording"} accessibilityState={{ disabled: publish.isPending }} disabled={publish.isPending} onPress={() => publish.mutate()} style={styles.button}>
        {publish.isPending && <ActivityIndicator color={c.text.strong} />}<Text style={styles.buttonText}>{publish.isPending ? (uncertain ? 'Checking…' : 'Publishing…') : uncertain ? 'Check publication status' : 'Publish recording'}</Text>
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

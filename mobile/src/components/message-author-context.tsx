import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { useWorkspace } from '@/providers/workspace-provider';
import { themedAlert as Alert } from '@/lib/alerts';
import { Avatar } from '@/components/avatar';
import { ErrorState, LoadingState } from '@/components/screen-states';
import type { StudentContextEnrollment } from '@/lib/api';
import type { Message } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { makeStyles } from '@/providers/theme-provider';
import { fonts } from '@/constants/csg-theme';
import { ENROLLMENT_STATUS_LABELS, ROLE_LABELS, humanize } from '@/lib/display-labels';

type Props = { author: Message['author']; cohortId?: number | null; workspaceId?: number | null; onClose: () => void };

export function MessageAuthorContext(props: Props) {
  return <Context key={`${props.author.id}:${props.cohortId}:${props.workspaceId}`} {...props} />;
}

function Context({ author, cohortId, workspaceId: messageWorkspaceId, onClose }: Props) {
  const styles = useStyles();
  const router = useRouter();
  const { api, user } = useSession();
  const { workspaces, activeWorkspaceId } = useWorkspace();
  const workspaceId = messageWorkspaceId ?? (cohortId ? workspaces.find(item => item.cohort_id === cohortId)?.id : activeWorkspaceId);
  const [permission, setPermission] = useState<{ workspaceId: number; viewerId: number; allowed: boolean } | null>(null);
  const canMessage = permission?.workspaceId === workspaceId && permission?.viewerId === user?.id && permission?.allowed;
  const [messaging, setMessaging] = useState(false);
  useEffect(() => {
    let active = true;
    if (workspaceId && author.id !== user?.id) void api.availableUsers(workspaceId).then(result => {
      if (active) setPermission({ workspaceId, viewerId: user?.id || 0, allowed: result.users.some(person => person.id === author.id) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, author.id, user?.id, workspaceId]);
  async function message() {
    if (!workspaceId || messaging) return;
    setMessaging(true);
    try {
      const result = await api.createDm(workspaceId, [author.id]);
      onClose();
      router.push(`/conversation/dm/${result.direct_conversation.id}`);
    } catch (error) { Alert.alert('Could not open message', (error as Error).message); }
    finally { setMessaging(false); }
  }
  const learner = Boolean(user?.is_staff && author.role === 'student');
  const [enrollments, setEnrollments] = useState<StudentContextEnrollment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const openEnrollment = (enrollment: StudentContextEnrollment) => {
    onClose();
    router.push({ pathname: '/staff/student/[id]', params: { id: String(author.id), cohort_id: String(enrollment.cohort_id) } });
  };
  useEffect(() => {
    if (!learner) return;
    let cancelled = false;
    void api.studentContext(author.id).then((result) => {
      if (!cancelled) setEnrollments(result.enrollments);
    }).catch((requestError: Error) => { if (!cancelled) setError(requestError.message); });
    return () => { cancelled = true; };
  }, [api, author.id, attempt, learner]);
  // Once authorized, a conversation's cohort is exact. Otherwise require a
  // choice whenever multiple enrollments are returned by the authorized API.
  const exact = enrollments?.find((enrollment) => enrollment.cohort_id === cohortId)
    ?? (enrollments?.length === 1 ? enrollments[0] : null);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close profile" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.identity}><Avatar name={author.full_name} /><View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>{author.full_name}</Text><Text style={styles.meta}>{humanize(author.role, ROLE_LABELS)}</Text></View></View>
          {canMessage && <Button variant="primary" disabled={messaging} onPress={() => void message()}>{messaging ? "Opening message…" : "Message"}</Button>}
          {exact && <Button variant="secondary" onPress={() => openEnrollment(exact)}>Student health</Button>}
          {learner && (error ? <ErrorState message={error} retry={() => { setError(null); setEnrollments(null); setAttempt((value) => value + 1); }} /> : !enrollments ? <LoadingState label="Loading student enrollments" /> : exact ? null : enrollments.length ? <View style={styles.choices}><Text style={styles.meta}>Choose an enrollment</Text>{enrollments.map((enrollment) => <Button key={enrollment.id} variant="secondary" onPress={() => openEnrollment(enrollment)}>{enrollment.cohort_name} · {humanize(enrollment.status, ENROLLMENT_STATUS_LABELS)}</Button>)}</View> : <Text style={styles.meta}>No accessible enrollments for this learner.</Text>)}
          <Button variant="secondary" onPress={onClose}>Close</Button>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: c.surface.raised },
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14 },
  choices: { gap: 8 },
}));

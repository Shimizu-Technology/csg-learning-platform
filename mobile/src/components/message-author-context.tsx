import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Avatar } from '@/components/avatar';
import { ErrorState, LoadingState } from '@/components/screen-states';
import type { StudentContextEnrollment } from '@/lib/api';
import type { Message } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { makeStyles } from '@/providers/theme-provider';
import { fonts } from '@/constants/csg-theme';

type Props = { author: Message['author']; cohortId?: number | null; onClose: () => void };

export function MessageAuthorContext(props: Props) {
  return <Context key={`${props.author.id}:${props.cohortId}`} {...props} />;
}

function Context({ author, cohortId, onClose }: Props) {
  const styles = useStyles();
  const router = useRouter();
  const { api, user } = useSession();
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
  useEffect(() => {
    if (exact) openEnrollment(exact);
    // Navigation is an outcome of this request, not of parent rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact]);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close profile" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.identity}><Avatar name={author.full_name} /><View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>{author.full_name}</Text><Text style={styles.meta}>{author.role}</Text></View></View>
          {learner && (error ? <ErrorState message={error} retry={() => { setError(null); setEnrollments(null); setAttempt((value) => value + 1); }} /> : !enrollments ? <LoadingState label="Loading student enrollments" /> : enrollments.length ? <View style={styles.choices}><Text style={styles.meta}>Choose an enrollment</Text>{enrollments.map((enrollment) => <Button key={enrollment.id} variant="secondary" onPress={() => openEnrollment(enrollment)}>{enrollment.cohort_name} · {enrollment.status}</Button>)}</View> : <Text style={styles.meta}>No accessible enrollments for this learner.</Text>)}
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

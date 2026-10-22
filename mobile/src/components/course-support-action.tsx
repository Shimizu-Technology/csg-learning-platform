import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { themedAlert as Alert } from '@/lib/alerts';
import { userStorageGeneration, userStorageGenerationIsCurrent } from '@/lib/user-storage-lifecycle';
import { loadConversationDraft, saveConversationDraft } from '@/lib/conversation-storage';
import { formatCourseDate } from '@/lib/course-time';
import type { EnrollmentCapabilities } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { makeStyles } from '@/providers/theme-provider';
import { fonts } from '@/constants/csg-theme';

export function CourseSupportAction({ capabilities, cohortId, contextLabel, contextPath }: { capabilities?: EnrollmentCapabilities; cohortId: number; contextLabel: string; contextPath?: string }) {
  const styles = useStyles();
  const { api, user } = useSession();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const courseQuestion = capabilities?.support_mode === 'course_question' && capabilities.support_instructor_id != null;

  async function openQuestion() {
    if (!user || !courseQuestion || opening) return;
    const generation = userStorageGeneration(user.id);
    setOpening(true);
    try {
      const { direct_conversation: conversation } = await api.createCohortDm(cohortId, [capabilities!.support_instructor_id!]);
      if (!userStorageGenerationIsCurrent(user.id, generation)) return;
      const existing = await loadConversationDraft(user.id, 'dm', conversation.id);
      if (!userStorageGenerationIsCurrent(user.id, generation)) return;
      const context = `Course question: ${contextLabel}${contextPath ? `\n${contextPath}` : ''}`;
      const next = existing.includes(context) ? existing : [existing, context].filter(Boolean).join('\n\n');
      if (next.length > 5000) throw new Error('Your instructor message draft is full. Open Messages and save or send it before adding this question.');
      await saveConversationDraft(user.id, 'dm', conversation.id, `${next}\n\n`);
      if (!userStorageGenerationIsCurrent(user.id, generation)) return;
      router.push(`/conversation/dm/${conversation.id}`);
    } catch (error) {
      Alert.alert('Could not open your course question', (error as Error).message);
    } finally {
      setOpening(false);
    }
  }

  if (capabilities?.support_mode === 'guided_help') return null;
  return <View style={styles.stack}>
    {courseQuestion ? <Button label={opening ? 'Opening instructor…' : 'Ask a course question'} accessibilityLabel="Ask a course question" variant="secondary" disabled={opening} onPress={() => void openQuestion()} /> : <>
      <Text style={styles.copy}>{capabilities ? capabilities.support_expires_at ? `Instructor support end date: ${formatCourseDate(capabilities.support_expires_at, { withYear: true })}.` : 'Instructor support is not included for this course.' : 'Course support is unavailable. Refresh to check your access.'}</Text>
      <Button label="Account support" variant="secondary" onPress={() => void Linking.openURL('mailto:codeschoolofguam@gmail.com?subject=CSG%20Learn%20account%20support').catch(() => Alert.alert('Account support', 'Email codeschoolofguam@gmail.com for help with your account.'))} />
    </>}
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => ({ stack: { gap: 8 }, copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 } }));

import { useRouter, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { PressableScale as Pressable } from './ui/pressable-scale';
import { LearningCard, SectionHeading } from './learning-ui';
import { useTheme } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';
import { themedAlert as Alert } from '@/lib/alerts';
import type { components } from '@/lib/api.generated';

export function InstructorToday({ today }: { today: components['schemas']['InstructorToday'] }) {
  const router = useRouter();
  const { api } = useSession();
  const { colors: c } = useTheme();
  const total = Object.values(today.counts).reduce((sum, count) => sum + count, 0);
  return <View style={{ gap: 12 }}><SectionHeading title="Today" />
    <Text style={{ color: c.text.body }}>{total === 1 ? '1 thing needs you' : `${total} things need you`}</Text>
    {total === 0 && !today.attention_remaining && <LearningCard><Text style={{ color: c.text.strong }}>You&apos;re caught up</Text><Text style={{ color: c.text.body }}>Check your cohorts or come back when new work arrives.</Text></LearningCard>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{Object.entries(today.counts).map(([kind, count]) => <Text key={kind} style={{ color: c.text.body, borderWidth: 1, borderRadius: 12, padding: 8 }}>{({ help: 'Help requests', review: 'Waiting for review', message: 'Unread conversations', quiet: 'Going quiet', follow_up: 'Follow-ups' } as Record<string, string>)[kind]} · {count}</Text>)}</View>
    {today.attention_remaining > 0 && <Pressable onPress={() => router.push('/staff/support' as Href)} style={{ minHeight: 44 }}><Text style={{ color: c.text.body }}>{today.attention_remaining} more {today.attention_remaining === 1 ? 'learner needs' : 'learners need'} attention → Support</Text></Pressable>}
    {today.items.map(item => <LearningCard key={`${item.kind}-${item.id}`}>
      <Pressable disabled={item.student_record === false || !item.cohort_id} accessibilityRole={item.student_record === false ? undefined : "link"} onPress={() => router.push(`/staff/student/${item.user_id}?cohort_id=${item.cohort_id}` as Href)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.text.strong, fontWeight: '700' }}>{item.full_name}</Text></Pressable>
      {item.cohort_id && item.cohort_name && <Pressable accessibilityRole="link" onPress={() => router.push(`/cohort/${item.cohort_id}` as Href)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.text.body }}>{item.cohort_name}</Text></Pressable>}
      <Text numberOfLines={3} style={{ color: c.text.body }}>{item.urgent ? 'Urgent · ' : ''}{item.text}</Text>
      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => {
        if (item.native_path) router.push(item.native_path as Href);
        else void api.createCohortDm(item.cohort_id!, [item.user_id]).then(result => router.push(`/conversation/dm/${result.direct_conversation.id}` as Href)).catch(error => Alert.alert('Could not open message', String(error)));
      }}><Text style={{ color: c.text.strong, fontWeight: '700' }}>{item.action_label}</Text></Pressable>
    </LearningCard>)}
    {today.upcoming.length > 0 && <SectionHeading title="Upcoming today" />}
    {today.upcoming.map((event, index) => <Text key={index} style={{ color: c.text.body }}>{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {event.title}</Text>)}
  </View>;
}

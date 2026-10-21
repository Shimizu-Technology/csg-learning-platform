import { useState } from 'react';
import { Text, View } from 'react-native';
import { MeetingButton, MeetingCohort, meetingStyles } from './private-meetings';
import { booking, cohort, now } from '@/lib/meeting-test-fixtures';

/** Read-only stress fixture, reachable only in development demo mode. */
export function PrivateMeetingsPreview() {
  const [worst, setWorst] = useState(false);
  const data = worst ? {
    ...cohort,
    name: 'Python Fundamentals — December invited beginner cohort with weekend private meetings',
    instructor_name: 'Aleksandra Wiśniewska-Kowalczyk',
    slots: [],
    bookings: [{ ...booking, instructor_name: 'Aleksandra Wiśniewska-Kowalczyk', zoom_url: null, reschedule_count: 1 }],
  } : cohort;
  return <View style={{ gap: 16 }}>
    <Text style={meetingStyles.notice}>Read-only demo. Sign in with your invited learner account to book a real private meeting.</Text>
    <MeetingButton label={worst ? 'Show demo data' : 'Show worst case data'} onPress={() => setWorst(!worst)}>Demo data / Worst case: {worst ? 'Worst case' : 'Demo data'}</MeetingButton>
    <MeetingCohort cohort={data} now={now} disabled onSelect={() => {}} onMessage={() => {}} onJoin={() => {}} />
  </View>;
}

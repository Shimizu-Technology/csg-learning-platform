// Frozen selection logic: main b5f207f mobile/src/components/weekly-plan.tsx.
// Intentionally independent of updated types/selectors: installed builds cannot change.
import { Text } from 'react-native';
type OldPlan = {
  enrolled: boolean;
  mode?: string;
  library_summary?: { module_count: number; lesson_count: number; recording_count: number };
  summary?: { required_count: number };
};
export function OldWeeklyPlanCard({ plan }: { plan: OldPlan }) {
  const summary = plan.summary;
  if (!plan.enrolled) return null;
  if (plan.mode === 'library' && plan.library_summary) return <LibraryPlan plan={plan} />;
  if (!summary) return null;
  return <Text>This Week</Text>;
}
function LibraryPlan({ plan }: { plan: OldPlan }) {
  const library = plan.library_summary!;
  return <Text>Alumni Learning Library · {library.module_count} modules · {library.lesson_count} lessons · {library.recording_count} recordings</Text>;
}

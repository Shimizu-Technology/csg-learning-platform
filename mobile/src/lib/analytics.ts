import { Platform } from 'react-native';
import PostHog from 'posthog-react-native';

type Role = 'student' | 'instructor' | 'admin';
export type VoiceSurface = 'message' | 'thread' | 'help_request' | 'grading_feedback';
type DurationBucket = 'under_15s' | '15_to_30s' | '31_to_60s' | '61_to_90s';
type LatencyBucket = 'under_2s' | '2_to_5s' | '6_to_10s' | 'over_10s';
type AgeBucket = 'same_day' | 'one_day' | 'two_to_three_days' | 'four_to_seven_days' | 'over_one_week';

export interface ProductEventMap {
  weekly_plan_viewed: { cohort_id: number; week_number: number; role: Role; required_count: number };
  learning_step_started: { cohort_id?: number; module_id: number; lesson_id: number; content_block_id?: number; block_type: string };
  learning_step_completed: { cohort_id?: number; module_id: number; lesson_id: number; content_block_id: number; block_type: string; source: 'manual' | 'video' | 'submission' };
  submission_created: { cohort_id?: number; content_block_id: number; submission_type: string; attempt: number };
  feedback_viewed: { cohort_id?: number; submission_id: number; grade_state: 'passed' | 'redo'; age_bucket: AgeBucket };
  redo_submitted: { cohort_id?: number; submission_id: number; attempt: number; age_bucket: AgeBucket };
  help_requested: { cohort_id: number; context_type: 'lesson' | 'exercise' | 'recording'; context_id: number; category: string; urgency: 'normal' | 'urgent' };
  help_request_resolved: { cohort_id: number; help_request_id: number; category: string; resolution_bucket: AgeBucket };
  intervention_opened: { cohort_id: number; intervention_id: number; trigger_type: string; severity: 'normal' | 'urgent' };
  intervention_resolved: { cohort_id: number; intervention_id: number; trigger_type: string; outcome: string; age_bucket: AgeBucket };
  recording_engaged: { cohort_id: number; recording_id: number; progress_bucket: 'started' | 'quarter' | 'half' | 'three_quarters' | 'complete'; captions_on: boolean };
  code_block_scrolled: { surface: 'message' | 'lesson'; overflow_bucket: 'short' | 'medium' | 'long' };
  code_block_copied: { surface: 'message' | 'lesson'; language: string };
  voice_draft_started: { surface: VoiceSurface; permission_state: 'unknown' | 'granted' | 'denied' };
  voice_draft_recorded: { surface: VoiceSurface; duration_bucket: DurationBucket };
  voice_draft_transcribed: { surface: VoiceSurface; latency_bucket: LatencyBucket; outcome: 'success' | 'empty' | 'timeout' | 'provider_error' | 'network_error' };
  voice_draft_inserted: { surface: VoiceSurface; raw_or_cleaned: 'raw' | 'cleaned' };
  voice_draft_restored: { surface: VoiceSurface };
  voice_draft_sent: { surface: VoiceSurface; edit_distance_bucket: 'none' | 'light' | 'substantial' };
  voice_draft_discarded: { surface: VoiceSurface; stage: 'recording' | 'transcribing' | 'review' };
}

export type ProductEventName = keyof ProductEventMap;
type SafeScalar = string | number | boolean;
type SafeEvent = { event: ProductEventName; properties: Record<string, SafeScalar> };

const PROPERTY_KEYS: { [Event in ProductEventName]: readonly (keyof ProductEventMap[Event])[] } = {
  weekly_plan_viewed: ['cohort_id', 'week_number', 'role', 'required_count'],
  learning_step_started: ['cohort_id', 'module_id', 'lesson_id', 'content_block_id', 'block_type'],
  learning_step_completed: ['cohort_id', 'module_id', 'lesson_id', 'content_block_id', 'block_type', 'source'],
  submission_created: ['cohort_id', 'content_block_id', 'submission_type', 'attempt'],
  feedback_viewed: ['cohort_id', 'submission_id', 'grade_state', 'age_bucket'],
  redo_submitted: ['cohort_id', 'submission_id', 'attempt', 'age_bucket'],
  help_requested: ['cohort_id', 'context_type', 'context_id', 'category', 'urgency'],
  help_request_resolved: ['cohort_id', 'help_request_id', 'category', 'resolution_bucket'],
  intervention_opened: ['cohort_id', 'intervention_id', 'trigger_type', 'severity'],
  intervention_resolved: ['cohort_id', 'intervention_id', 'trigger_type', 'outcome', 'age_bucket'],
  recording_engaged: ['cohort_id', 'recording_id', 'progress_bucket', 'captions_on'],
  code_block_scrolled: ['surface', 'overflow_bucket'],
  code_block_copied: ['surface', 'language'],
  voice_draft_started: ['surface', 'permission_state'],
  voice_draft_recorded: ['surface', 'duration_bucket'],
  voice_draft_transcribed: ['surface', 'latency_bucket', 'outcome'],
  voice_draft_inserted: ['surface', 'raw_or_cleaned'],
  voice_draft_restored: ['surface'],
  voice_draft_sent: ['surface', 'edit_distance_bucket'],
  voice_draft_discarded: ['surface', 'stage'],
};

const OPTIONAL_KEYS: Partial<Record<ProductEventName, readonly string[]>> = {
  learning_step_started: ['cohort_id', 'content_block_id'],
  learning_step_completed: ['cohort_id'],
  submission_created: ['cohort_id'],
  feedback_viewed: ['cohort_id'],
  redo_submitted: ['cohort_id'],
};

const SAFE_CATEGORY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
export const isAnalyticsEnabled = Boolean(POSTHOG_KEY && POSTHOG_KEY !== 'YOUR_POSTHOG_KEY' && !__DEV__);
export const analyticsClient = isAnalyticsEnabled ? new PostHog(POSTHOG_KEY!, {
  host: POSTHOG_HOST,
  captureAppLifecycleEvents: false,
  enableSessionReplay: false,
}) : null;

export function safeProductEvent<Event extends ProductEventName>(event: Event, properties: ProductEventMap[Event]): SafeEvent | null {
  const allowed = new Set<string>(PROPERTY_KEYS[event] as readonly string[]);
  const entries = Object.entries(properties as Record<string, unknown>);
  const safeProperties: Record<string, SafeScalar> = { platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other' };

  for (const [key, value] of entries) {
    if (!allowed.has(key) || value === undefined) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      safeProperties[key] = value;
    } else if (typeof value === 'boolean') {
      safeProperties[key] = value;
    } else if (typeof value === 'string' && SAFE_CATEGORY.test(value)) {
      safeProperties[key] = value;
    } else {
      return null;
    }
  }

  const optional = new Set(OPTIONAL_KEYS[event] || []);
  const missingRequired = (PROPERTY_KEYS[event] as readonly string[])
    .some((key) => !optional.has(key) && !(key in safeProperties));
  if (missingRequired) return null;

  return { event, properties: safeProperties };
}

export function captureProductEvent<Event extends ProductEventName>(event: Event, properties: ProductEventMap[Event]) {
  const safe = safeProductEvent(event, properties);
  if (!safe || !analyticsClient) return false;
  analyticsClient.capture(safe.event, safe.properties);
  return true;
}

export function analyticsAgeBucket(timestamp: string | null | undefined, now = Date.now()): AgeBucket {
  const parsed = timestamp ? Date.parse(timestamp) : now;
  const elapsedDays = Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 86_400_000) : 0;
  if (elapsedDays < 1) return 'same_day';
  if (elapsedDays < 2) return 'one_day';
  if (elapsedDays < 4) return 'two_to_three_days';
  if (elapsedDays < 8) return 'four_to_seven_days';
  return 'over_one_week';
}

export function analyticsLanguage(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return normalized && normalized.length <= 24 ? normalized : 'other';
}

export function durationBucket(durationSeconds: number): DurationBucket {
  if (durationSeconds < 15) return 'under_15s';
  if (durationSeconds <= 30) return '15_to_30s';
  if (durationSeconds <= 60) return '31_to_60s';
  return '61_to_90s';
}

export function latencyBucket(durationMilliseconds: number): LatencyBucket {
  if (durationMilliseconds < 2_000) return 'under_2s';
  if (durationMilliseconds <= 5_000) return '2_to_5s';
  if (durationMilliseconds <= 10_000) return '6_to_10s';
  return 'over_10s';
}

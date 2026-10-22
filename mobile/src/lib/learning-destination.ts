import { LEARN_WEB_ORIGIN } from './hafa-starter-links';

// Fallback for cached payloads predating destination_path. Mirrors #196
// LearningDestination.recording; legacy context IDs are zero-based.
export function webRecordingUrl(cohortId: number, recordingId: number, source: 'primary' | 'legacy' = 'primary') {
  const identity = source === 'legacy' ? `legacy-${cohortId}-${recordingId + 1}` : String(recordingId);
  return `${LEARN_WEB_ORIGIN}/recordings?cohort_id=${cohortId}&recording=${identity}`;
}

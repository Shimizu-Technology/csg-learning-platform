import { toWebPath } from './record-destination';
import { LEARN_WEB_ORIGIN } from './hafa-starter-links';

// Fallback for cached payloads predating destination_path. Mirrors #196
// LearningDestination.recording; legacy context IDs are zero-based.
export function webRecordingUrl(cohortId: number, recordingId: number, source: 'primary' | 'legacy' = 'primary') {
  const identity = source === 'legacy' ? `legacy-${cohortId}-${recordingId + 1}` : String(recordingId);
  const path = toWebPath({ kind: 'recording', id: identity, context: { cohort_id: cohortId }, anchor: {} });
  return path ? `${LEARN_WEB_ORIGIN}${path}` : null;
}

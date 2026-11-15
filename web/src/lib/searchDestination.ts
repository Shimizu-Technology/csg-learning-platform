import type { RecordDestination } from './recordDestination'
import { toWebPath } from './recordDestination'
import { recordPath, type RecordRef, type RecordViewer } from './routes'

/** Adapt the wire contract through the role-aware route registry. New list
 * destinations (team, curriculum, resources) use their additive wire adapter. */
export function searchDestinationPath(d: RecordDestination, viewer: RecordViewer): string | null {
  const id = Number(d.id)
  const cohortId = Number(d.context?.cohort_id) || undefined
  const messageId = Number(d.anchor?.message_id) || undefined
  let ref: RecordRef | null = null
  switch (d.kind) {
    case 'student': ref = { type: 'student', id }; break
    case 'cohort': ref = { type: 'cohort', id }; break
    case 'module': ref = { type: 'module', id, cohortId }; break
    case 'lesson': ref = { type: 'lesson', id, cohortId, view: 'learn', anchor: d.anchor?.block_id ? `block-${d.anchor.block_id}` : undefined }; break
    case 'submission': ref = { type: 'submission', id, cohortId }; break
    case 'help_request': ref = { type: 'help_request', id }; break
    case 'follow_up': ref = { type: 'intervention', id }; break
    case 'channel': ref = { type: 'channel', id, messageId }; break
    case 'dm': ref = { type: 'direct_conversation', id, messageId }; break
    case 'announcement': ref = { type: 'announcement', id }; break
    case 'recording': ref = { type: 'recording', id, cohortId }; break
  }
  return ref ? recordPath(ref, { viewer }) : toWebPath(d)
}

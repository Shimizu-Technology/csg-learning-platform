import type { RecordDestination } from './recordDestination'
import { toWebPath } from './recordDestination'
import { recordPath, type RecordRef, type RecordViewer } from './routes'

/**
 * The web record a wire destination names, for `<RecordLink>` and the route
 * registry, or null for kinds with no record page (team, curriculum,
 * resources, meetings, Safety items).
 */
export function recordRefFromDestination(d: RecordDestination): RecordRef | null {
  const id = Number(d.id)
  const cohortId = Number(d.context?.cohort_id) || undefined
  const messageId = Number(d.anchor?.message_id) || undefined
  switch (d.kind) {
    case 'student': return { type: 'student', id }
    case 'cohort': return { type: 'cohort', id }
    case 'module': return { type: 'module', id, cohortId }
    case 'lesson': return { type: 'lesson', id, cohortId, view: 'learn', anchor: d.anchor?.block_id ? `block-${d.anchor.block_id}` : undefined }
    case 'submission': return { type: 'submission', id, cohortId, userId: Number(d.context?.student_id) || undefined }
    case 'help_request': return { type: 'help_request', id }
    case 'follow_up': return { type: 'intervention', id }
    case 'channel': return { type: 'channel', id, messageId }
    case 'dm': return { type: 'direct_conversation', id, messageId }
    case 'announcement': return { type: 'announcement', id }
    case 'recording': return { type: 'recording', id, cohortId }
    default: return null
  }
}

/** Adapt the wire contract through the role-aware route registry. New list
 * destinations (team, curriculum, resources) use their additive wire adapter. */
export function searchDestinationPath(d: RecordDestination, viewer: RecordViewer): string | null {
  const ref = recordRefFromDestination(d)
  return ref ? recordPath(ref, { viewer }) : toWebPath(d)
}

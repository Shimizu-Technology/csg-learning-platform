/** Twins: web/src/lib/recordDestination.ts and mobile/src/lib/record-destination.ts. Keep equivalent apart from package-local import paths. */
/** Wire contract v1. Unknown/invalid context entries are discarded independently. */
import type { components } from './api.generated'
export type RecordDestination = components['schemas']['RecordDestination']
const numeric = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number') && /^(?:[1-9]\d*)$/.test(String(value)) ? String(value) : null
const keys: Record<string, string[]> = {
  lesson: ['cohort_id'], module: [], submission: ['cohort_id', 'student_id'],
  help_request: [], follow_up: [], channel: [], dm: [], announcement: [],
  recording: ['cohort_id'], meeting: ['cohort_id', 'booking_id', 'week'], cohort: [],
}
export function toWebPath(target: unknown): string | null { return adapt(target, false) }
export function toNativeHref(target: unknown): string | null { return adapt(target, true) }
function adapt(target: unknown, native: boolean): string | null {
  if (!target || typeof target !== 'object') return null
  const d = target as RecordDestination
  if (!Object.hasOwn(keys, d.kind)) return null
  const id = d.kind === 'recording' && /^(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(String(d.id)) ? String(d.id) : numeric(d.id)
  if (!id && d.kind !== 'meeting') return null
  const web: Record<string, string> = { lesson: `/lessons/${id}`, module: `/modules/${id}`, submission: `/admin/submissions/${id}`, help_request: `/admin/help-requests/${id}`, follow_up: `/admin/interventions/${id}`, channel: `/messages/${id}`, dm: `/messages/dm/${id}`, announcement: `/announcements/${id}`, recording: '/recordings', meeting: '/meetings', cohort: `/cohorts/${id}` }
  const app: Record<string, string> = { lesson: `/lesson/${id}`, module: `/module/${id}`, submission: `/staff/submission/${id}`, help_request: `/staff/support/${id}`, follow_up: `/staff/intervention/${id}`, channel: `/conversation/channel/${id}`, dm: `/conversation/dm/${id}`, announcement: '/updates', recording: `/recording/${id}`, meeting: '/meetings', cohort: `/cohort/${id}` }
  const params = new URLSearchParams()
  for (const key of keys[d.kind]) {
    const value = numeric(d.context?.[key])
    if (value) params.set(key, value)
  }
  if (d.kind === 'meeting' && d.context?.staff === true && !native) web.meeting = '/admin/meetings'
  if (d.kind === 'recording' && !native) params.set('recording', id!)
  if (d.kind === 'announcement' && native) params.set('announcement_id', id!)
  const block = d.kind === 'lesson' ? numeric(d.anchor?.block_id) : null
  const message = ['channel', 'dm'].includes(d.kind) ? numeric(d.anchor?.message_id ?? d.anchor?.messageId) : null
  if (message) params.set('message_id', message)
  if (block && native) params.set('block_id', block)
  const query = params.toString()
  return (native ? app : web)[d.kind] + (query ? `?${query}` : '') + (block && !native ? `#block-${block}` : '')
}

/** Legacy stored web paths are decoded at the boundary, never interpreted as URLs. */
export function fromWebPath(value: unknown): RecordDestination | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.split('#').length > 2 || /[\s\\]/.test(value)) return null
  const url = new URL(value, 'https://csg.invalid')
  if (url.pathname !== value.split(/[?#]/)[0]) return null
  const context: Record<string, unknown> = {}
  for (const key of new Set(url.searchParams.keys())) if (url.searchParams.getAll(key).length === 1) context[key] = url.searchParams.get(key)
  const routes: [string, RegExp][] = [['lesson', /^\/lessons\/([1-9]\d*)$/], ['module', /^\/modules\/([1-9]\d*)$/], ['submission', /^\/admin\/submissions\/([1-9]\d*)$/], ['help_request', /^\/admin\/help-requests\/([1-9]\d*)$/], ['follow_up', /^\/admin\/interventions\/([1-9]\d*)$/], ['dm', /^\/messages\/dm\/([1-9]\d*)$/], ['channel', /^\/messages\/([1-9]\d*)$/], ['announcement', /^\/announcements\/([1-9]\d*)$/], ['cohort', /^\/cohorts\/([1-9]\d*)$/]]
  for (const [kind, pattern] of routes) {
    const match = url.pathname.match(pattern)
    if (match) return { kind, id: match[1], context, anchor: { block_id: url.hash.match(/^#block-([1-9]\d*)$/)?.[1] ?? numeric(context.block_id) ?? undefined, message_id: context.message_id ?? context.messageId } }
  }
  if (url.pathname === '/recordings' && /^(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(String(context.recording))) return { kind: 'recording', id: String(context.recording), context, anchor: {} }
  if (['/meetings', '/admin/meetings'].includes(url.pathname)) return { kind: 'meeting', id: String(context.booking_id ?? ''), context: { ...context, staff: url.pathname.startsWith('/admin') }, anchor: {} }
  return null
}

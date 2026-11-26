import aliases from '../../../api/config/record_destination_aliases.json'
/** Twins: web/src/lib/recordDestination.ts and mobile/src/lib/record-destination.ts. Keep equivalent apart from package-local import paths. */
/** Wire contract v1. Unknown/invalid context entries are discarded independently. */
import type { components } from '../types/api.generated'
export type RecordDestination = components['schemas']['RecordDestination']
const numeric = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number') && /^(?:[1-9]\d*)$/.test(String(value)) ? String(value) : null
const keys: Record<string, string[]> = {
  student: ['cohort_id'], staff: [], curriculum: ['cohort_id'], resource: ['cohort_id'], cohort_file: ['cohort_id', 'student_id'], lesson: ['cohort_id', 'help_request'], module: ['cohort_id'], submission: ['cohort_id', 'student_id'],
  help_request: ['cohort_id', 'student_id'], follow_up: [], channel: [], dm: [], announcement: ['cohort_id'],
  recording: ['cohort_id'], meeting: ['cohort_id', 'booking_id', 'week'], cohort: [],
  // Admin-only Safety items. Web only: native clients have no Safety page and fall back to Updates.
  content_report: [], deletion_request: [],
}
/** Kinds with no native screen. Installed builds that predate a kind also return null for it. */
const webOnly = new Set(['staff', 'content_report', 'deletion_request'])
export function toWebPath(target: unknown): string | null { return adapt(target, false) }
export function toNativeHref(target: unknown): string | null { return adapt(target, true) }
function adapt(target: unknown, native: boolean): string | null {
  if (!target || typeof target !== 'object') return null
  const d = target as RecordDestination
  if (!Object.hasOwn(keys, d.kind)) return null
  const id = d.kind === 'recording' && /^(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(String(d.id)) ? String(d.id) : numeric(d.id)
  if (!id && d.kind !== 'meeting') return null
  if (d.kind === 'cohort_file') {
    const cohortId = numeric(d.context?.cohort_id)
    const studentId = numeric(d.context?.student_id)
    if (d.context?.staff === true) {
      if (!cohortId) return null
      const fileParams = new URLSearchParams()
      if (native) {
        fileParams.set('cohort_id', cohortId)
        if (studentId) fileParams.set('student', studentId)
        fileParams.set('file', id!)
        return `/staff/files?${fileParams.toString()}`
      }
      fileParams.set('tab', 'files')
      if (studentId) fileParams.set('student', studentId)
      fileParams.set('file', id!)
      return `/admin/cohorts/${cohortId}?${fileParams.toString()}`
    }
    const fileParams = new URLSearchParams()
    if (cohortId) fileParams.set('cohort_id', cohortId)
    fileParams.set('file', id!)
    return `/resources?${fileParams.toString()}`
  }
  const web: Record<string, string> = { student: `/admin/students/${id}`, staff: `/admin/team/${id}`, curriculum: d.context?.staff === true ? '/admin/content' : '/materials', resource: '/resources', lesson: `/lessons/${id}`, module: `/modules/${id}`, submission: `/admin/submissions/${id}`, help_request: `/admin/help-requests/${id}`, follow_up: `/admin/interventions/${id}`, channel: `/messages/${id}`, dm: `/messages/dm/${id}`, announcement: `/announcements/${id}`, recording: '/recordings', meeting: '/meetings', cohort: d.context?.staff === true ? `/admin/cohorts/${id}` : `/cohorts/${id}`, content_report: '/admin/moderation', deletion_request: '/admin/moderation' }
  const app: Record<string, string> = { student: `/staff/student/${id}`, staff: '/staff/team', curriculum: d.context?.staff === true ? `/staff/curriculum/${id}` : '/learn', resource: '/resources', lesson: `/lesson/${id}`, module: `/module/${id}`, submission: `/staff/submission/${id}`, help_request: `/staff/support/${id}`, follow_up: `/staff/intervention/${id}`, channel: `/conversation/channel/${id}`, dm: `/conversation/dm/${id}`, announcement: '/updates', recording: `/recording/${id}`, meeting: '/meetings', cohort: `/cohort/${id}` }
  const params = new URLSearchParams()
  for (const key of keys[d.kind]) {
    const value = numeric(d.context?.[key])
    if (value) params.set(key, value)
  }
  if (d.kind === 'resource') params.set('resource', id!)
  if (d.kind === 'resource' && typeof d.context?.query === 'string') params.set('q', d.context.query.slice(0, 180))
  if (native && webOnly.has(d.kind)) return null
  if (d.kind === 'meeting' && d.context?.staff === true && !native) web.meeting = '/admin/meetings'
  if (d.kind === 'recording' && !native) params.set('recording', id!)
  if (d.kind === 'announcement' && native) params.set('announcement_id', id!)
  const block = d.kind === 'lesson' ? numeric(d.anchor?.block_id) : null
  const message = ['channel', 'dm'].includes(d.kind) ? numeric(d.anchor?.message_id ?? d.anchor?.messageId) : null
  if (message) params.set('message_id', message)
  if (block && native) params.set('block_id', block)
  const query = params.toString()
  const safety = d.kind === 'content_report' ? `#report-${id}` : d.kind === 'deletion_request' ? `#deletion-${id}` : ''
  return (native ? app : web)[d.kind] + (query ? `?${query}` : '') + (block && !native ? `#block-${block}` : d.kind === 'curriculum' && d.context?.staff === true && !native ? `#curriculum-${id}` : safety)
}

/** Legacy stored web paths are decoded at the boundary, never interpreted as URLs. */
export function fromWebPath(value: unknown): RecordDestination | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.split('#').length > 2 || /[\s\\]/.test(value)) return null
  const rawUrl = new URL(value, 'https://csg.invalid')
  if (rawUrl.pathname === value.split(/[?#]/)[0]) {
    const staffFiles = rawUrl.pathname.match(/^\/admin\/cohorts\/([1-9]\d*)$/)
    if (staffFiles && rawUrl.searchParams.getAll('tab').length === 1 && rawUrl.searchParams.get('tab') === 'files' && rawUrl.searchParams.getAll('file').length === 1 && numeric(rawUrl.searchParams.get('file'))) {
      const student = rawUrl.searchParams.getAll('student').length === 1 ? numeric(rawUrl.searchParams.get('student')) : null
      return { kind: 'cohort_file', id: String(rawUrl.searchParams.get('file')), context: { cohort_id: staffFiles[1], ...(student ? { student_id: student } : {}), staff: true }, anchor: {} }
    }
  }
  for (const alias of aliases) {
    const base = value.split(/[?#]/)[0]
    if (new RegExp(alias.pattern).test(base)) {
      const target = base.replace(new RegExp(alias.pattern), alias.replacement)
      const source = new URL(value, 'https://csg.invalid')
      const mapped = new URL(target, 'https://csg.invalid')
      const fixed = new Set(mapped.searchParams.keys())
      for (const [key, entry] of source.searchParams) if (!fixed.has(key)) mapped.searchParams.append(key, entry)
      const result = fromWebPath(mapped.pathname + mapped.search + mapped.hash)
      return result ? { ...result, context: { ...result.context, ...('context' in alias ? alias.context : {}) } } : null
    }
  }
  const url = new URL(value, 'https://csg.invalid')
  if (url.pathname !== value.split(/[?#]/)[0]) return null
  const context: Record<string, unknown> = {}
  for (const key of new Set(url.searchParams.keys())) if (url.searchParams.getAll(key).length === 1) context[key] = url.searchParams.get(key)
  const routes: [string, RegExp][] = [['lesson', /^\/lessons\/([1-9]\d*)$/], ['module', /^\/modules\/([1-9]\d*)$/], ['submission', /^\/admin\/submissions\/([1-9]\d*)$/], ['help_request', /^\/admin\/help-requests\/([1-9]\d*)$/], ['follow_up', /^\/admin\/interventions\/([1-9]\d*)$/], ['dm', /^\/messages\/dm\/([1-9]\d*)$/], ['channel', /^\/messages\/([1-9]\d*)$/], ['announcement', /^\/announcements\/([1-9]\d*)$/], ['cohort', /^\/cohorts\/([1-9]\d*)$/], ['student', /^\/admin\/students\/([1-9]\d*)$/], ['staff', /^\/admin\/team\/([1-9]\d*)$/]]
  for (const [kind, pattern] of routes) {
    const match = url.pathname.match(pattern)
    if (match) return { kind, id: match[1], context, anchor: { block_id: url.hash.match(/^#block-([1-9]\d*)$/)?.[1] ?? numeric(context.block_id) ?? undefined, message_id: context.message_id ?? context.messageId } }
  }
  const curriculum = url.pathname === '/admin/content' ? url.hash.match(/^#curriculum-([1-9]\d*)$/) : null
  if (curriculum) return { kind: 'curriculum', id: curriculum[1], context: { ...context, staff: true }, anchor: {} }
  const safety = url.pathname === '/admin/moderation' ? url.hash.match(/^#(report|deletion)-([1-9]\d*)$/) : null
  if (safety) return { kind: safety[1] === 'report' ? 'content_report' : 'deletion_request', id: safety[2], context: {}, anchor: {} }
  if (url.pathname === '/recordings' && /^(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(String(context.recording))) return { kind: 'recording', id: String(context.recording), context, anchor: {} }
  if (url.pathname === '/resources' && numeric(context.file)) return { kind: 'cohort_file', id: String(context.file), context: numeric(context.cohort_id) ? { cohort_id: String(context.cohort_id) } : {}, anchor: {} }
  if (['/meetings', '/admin/meetings'].includes(url.pathname)) return { kind: 'meeting', id: String(context.booking_id ?? ''), context: { ...context, staff: url.pathname.startsWith('/admin') }, anchor: {} }
  return null
}

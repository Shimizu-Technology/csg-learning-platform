import { fromWebPath, toNativeHref, type RecordDestination } from './record-destination';

const SIMPLE = new Set(['/', '/meetings', '/learn', '/resources', '/recordings', '/updates', '/staff/grading', '/staff/support']);
function descriptorFromPath(value: string): RecordDestination | null {
  if (/[\s\\]/.test(value) || value.startsWith('//') || value.split('?').length > 2 || value.split('#').length > 2) return null;
  const web = fromWebPath(value);
  if (web) return web;
  const [base, query] = value.split('?');
  const params = new URLSearchParams(query);
  const routes: [RegExp, string][] = [
    [/^\/lesson\/([1-9]\d*)$/, '/lessons/'], [/^\/module\/([1-9]\d*)$/, '/modules/'],
    [/^\/conversation\/channel\/([1-9]\d*)$/, '/messages/'], [/^\/conversation\/dm\/([1-9]\d*)$/, '/messages/dm/'],
    [/^\/staff\/submission\/([1-9]\d*)$/, '/admin/submissions/'], [/^\/staff\/support\/([1-9]\d*)$/, '/admin/help-requests/'],
    [/^\/staff\/intervention\/([1-9]\d*)$/, '/admin/interventions/'], [/^\/cohort\/([1-9]\d*)$/, '/cohorts/'],
  ];
  for (const [pattern, prefix] of routes) {
    const match = base.match(pattern);
    if (!match) continue;
    const block = params.getAll('block_id').length === 1 ? params.get('block_id') : null;
    params.delete('block_id');
    return fromWebPath(`${prefix}${match[1]}?${params}${block && /^[1-9]\d*$/.test(block) ? `#block-${block}` : ''}`);
  }
  const recording = base.match(/^\/recording\/([1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/);
  if (recording) return { kind: 'recording', id: recording[1], context: Object.fromEntries([...new Set(params.keys())].filter(key => params.getAll(key).length === 1).map(key => [key, params.get(key)])), anchor: {} };
  if (base === '/updates' && params.getAll('announcement_id').length === 1) return { kind: 'announcement', id: params.get('announcement_id'), context: {}, anchor: {} };
  return null;
}

export function isAllowedNotificationPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (SIMPLE.has(value) || /^\/staff\/student\/[1-9]\d*$/.test(value) || /^\/recording\/(?:recording|uploaded)-[1-9]\d*$/.test(value)) return true;
  const canonical = toNativeHref(descriptorFromPath(value));
  return canonical === value || canonical === value.replace('?messageId=', '?message_id=');
}

/** New descriptor first; legacy stored paths are parsed at this boundary. */
export function mobileNotificationPath(value: unknown, messageId?: unknown): string {
  const descriptor = typeof value === 'string' ? descriptorFromPath(value) : value;
  let canonical = toNativeHref(descriptor);
  if (canonical && descriptor && typeof descriptor === 'object' && 'kind' in descriptor && ['dm', 'channel'].includes(String(descriptor.kind)) && !canonical.includes('?') && /^[1-9]\d*$/.test(String(messageId))) canonical += `?message_id=${messageId}`;
  if (canonical) return canonical;
  if (isAllowedNotificationPath(value)) return value;
  if (value === '/dashboard') return '/';
  if (value === '/admin/grading') return '/staff/grading';
  if (value === '/admin/support') return '/staff/support';
  return '/updates';
}

/**
 * A readable notification title. Notifications created before the API used
 * the lesson title as a fallback can end in "requested a redo on" or
 * "graded : A" when the exercise had no title of its own.
 */
export function notificationTitle(item: { title?: string | null; notification_type?: string | null }) {
  const title = (item.title || '').trim();
  if (!title) return item.notification_type === 'redo' ? 'Redo requested' : 'New update';
  return title.replace(/ (requested a redo on|graded)\s*(?=:|$)/, ' $1 your exercise');
}

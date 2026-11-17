import { fromWebPath, toNativeHref, toWebPath, type RecordDestination } from './record-destination';

const SIMPLE = new Set(['/', '/meetings', '/learn', '/resources', '/recordings', '/updates', '/messages', '/staff/grading', '/staff/support']);
export function descriptorFromPath(value: string): RecordDestination | null {
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
  return null;
}

export function isAllowedNotificationPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '/link-unavailable' || /^\/thread\/[1-9]\d*$/.test(value) || /^\/cohort\/[1-9]\d*\/schedule$/.test(value)) return true;
  if (value.startsWith('/link-unavailable?path=')) return webFallbackPath(new URLSearchParams(value.split('?')[1]).get('path')) === value;
  if (SIMPLE.has(value) || /^\/staff\/student\/[1-9]\d*$/.test(value) || /^\/recording\/(?:recording|uploaded)-[1-9]\d*$/.test(value)) return true;
  const canonical = toNativeHref(descriptorFromPath(value)) ?? legacyNativePath(value);
  return canonical === value || canonical === value.replace('?messageId=', '?message_id=');
}

/** New descriptor first; legacy stored paths are parsed at this boundary. */
export function mobileNotificationPath(value: unknown, messageId?: unknown, legacyPath?: unknown): string {
  const descriptor = typeof value === 'string' ? descriptorFromPath(value) : value;
  let canonical = toNativeHref(descriptor);
  if (!canonical && toWebPath(descriptor)) return webFallbackPath(toWebPath(descriptor));
  if (!canonical && legacyPath !== undefined) return mobileNotificationPath(legacyPath, messageId);
  if (canonical && descriptor && typeof descriptor === 'object' && 'kind' in descriptor && ['dm', 'channel'].includes(String(descriptor.kind)) && !/[?&]message_id=/.test(canonical) && /^[1-9]\d*$/.test(String(messageId))) canonical += `${canonical.includes('?') ? '&' : '?'}message_id=${messageId}`;
  if (canonical) return canonical;
  const legacy = legacyNativePath(value);
  if (legacy) return legacy;
  if (isAllowedNotificationPath(value)) return value;
  if (typeof value === 'string' && /^\/thread\/[1-9]\d*$/.test(value)) return value;
  if (typeof value === 'string' && /^\/cohort\/[1-9]\d*\/schedule$/.test(value)) return value;
  if (value === '/staff/curriculum') return '/learn';
  if (typeof value === 'string' && /^\/admin\/cohorts\/[1-9]\d*\/schedule$/.test(value)) return value.replace('/admin/cohorts/', '/cohort/');
  if (value === '/materials') return '/learn';
  if (value === '/admin/content') return '/learn';
  if (value === '/dashboard') return '/';
  if (value === '/admin/grading') return '/staff/grading';
  if (value === '/admin/support') return '/staff/support';
  const webPath = typeof value === 'string' ? value : toWebPath(value);
  return webFallbackPath(webPath);
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

function legacyNativePath(value: unknown): string | null {
  if (typeof value === 'string' && !/[\s\\#]/.test(value)) {
    const [base, query] = value.split('?');
    if (base === '/updates' || /^\/recording\/(?:uploaded|recording)-[1-9]\d*$/.test(base)) {
      const input = new URLSearchParams(query);
      const params = new URLSearchParams();
      for (const key of base === '/updates' ? ['cohort_id', 'announcement_id'] : ['cohort_id']) {
        const entry = input.getAll(key);
        if (entry.length === 1 && /^[1-9]\d*$/.test(entry[0])) params.set(key, entry[0]);
      }
      return base + (params.size ? `?${params}` : '');
    }
  }
  return null;
}

export function webFallbackPath(path: unknown): string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\s\\]/.test(path) && !path.startsWith('/link-unavailable')
    ? `/link-unavailable?path=${encodeURIComponent(path)}` : '/link-unavailable';
}
export function requiresStaff(path: string): boolean {
  const source = path.startsWith('/link-unavailable?') ? new URLSearchParams(path.split('?')[1]).get('path') || '' : path;
  return /^\/(staff|admin)(\/|$)/.test(source);
}

const CONVERSATION_PATH = /^\/conversation\/(channel|dm)\/\d+$/;
const WEB_CHANNEL_PATH = /^\/messages\/(\d+)$/;
const WEB_DM_PATH = /^\/messages\/dm\/(\d+)$/;
const WEB_ANNOUNCEMENT_PATH = /^\/announcements\/(\d+)$/;
const WEB_SUBMISSION_PATH = /^\/admin\/submissions\/(\d+)$/;
const WEB_HELP_REQUEST_PATH = /^\/admin\/help-requests\/(\d+)$/;
const WEB_INTERVENTION_PATH = /^\/admin\/interventions\/(\d+)$/;
const LEARNING_PATH = /^\/(lesson|module)\/[1-9]\d*$/;
const STAFF_PATH = /^\/staff\/(student|support|intervention)\/\d+$/;
const STAFF_SUBMISSION_PATH = /^\/staff\/submission\/(\d+)$/;

function submissionPath(value: string, source: RegExp): string | null {
  const [pathname, query, ...extra] = value.split('?');
  const match = pathname.match(source);
  if (!match || extra.length) return null;
  const base = `/staff/submission/${match[1]}`;
  if (!query) return base;

  const params = new URLSearchParams(query);
  const cohortIds = params.getAll('cohort_id');
  const studentIds = params.getAll('student_id');
  const onlyContextKeys = Array.from(params.keys()).every((key) => key === 'cohort_id' || key === 'student_id');
  if (!onlyContextKeys || cohortIds.length !== 1 || studentIds.length !== 1) return base;
  if (!/^\d+$/.test(cohortIds[0]) || !/^\d+$/.test(studentIds[0])) return base;

  return `${base}?cohort_id=${cohortIds[0]}&student_id=${studentIds[0]}`;
}

// Only known numeric context keys may enter native notification routes.
function contextPath(value: string): string | null {
  const [pathname, query, ...extra] = value.split('?');
  if (extra.length || value.includes('#')) return null;
  const keys = /^\/lesson\/[1-9]\d*$/.test(pathname) ? ['cohort_id', 'block_id']
    : /^\/recording\/(?:[1-9]\d*|(?:recording|uploaded)-[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(pathname) ? ['cohort_id']
    : pathname === '/meetings' ? ['cohort_id', 'booking_id', 'week']
    : pathname === '/updates' ? ['announcement_id', 'cohort_id']
    : /^\/cohort\/[1-9]\d*$/.test(pathname) ? [] : null;
  if (!keys) return null;
  if (!query) return pathname;
  const params = new URLSearchParams(query);
  if (!Array.from(params.keys()).length || Array.from(params.keys()).some((key) => !keys.includes(key) || params.getAll(key).length !== 1 || !/^[1-9]\d*$/.test(params.get(key) || ''))) return null;
  return `${pathname}?${params.toString()}`;
}

function webLearningPath(value: string): string | null {
  const [base, fragment, ...extra] = value.split('#');
  if (extra.length) return null;
  if (/^\/lessons\/[1-9]\d*(?:\?|$)/.test(base)) {
    if (fragment && !/^block-[1-9]\d*$/.test(fragment)) return null;
    const native = base.replace('/lessons/', '/lesson/');
    return contextPath(fragment ? `${native}${native.includes('?') ? '&' : '?'}block_id=${fragment.slice(6)}` : native);
  }
  const [pathname, query] = base.split('?');
  if (pathname === '/recordings' && query && !fragment) {
    const params = new URLSearchParams(query);
    if (Array.from(params.keys()).some((key) => !['recording', 'cohort_id'].includes(key) || params.getAll(key).length !== 1)) return null;
    const recording = params.get('recording');
    const cohort = params.get('cohort_id');
    if (!recording || !/^(?:[1-9]\d*|legacy-[1-9]\d*-[1-9]\d*)$/.test(recording)) return null;
    return contextPath(`/recording/${recording}${cohort ? `?cohort_id=${cohort}` : ''}`);
  }
  return null;
}

export function isAllowedNotificationPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const conversation = conversationNotificationPath(value);
  const staffSubmission = submissionPath(value, STAFF_SUBMISSION_PATH);
  const contextual = contextPath(value);
  return contextual === value || value === '/' || value === '/meetings' || value === '/learn' || value === '/resources' || value === '/recordings' || value === '/updates' || value === '/staff/grading' || value === '/staff/support' || staffSubmission === value || conversation === value || LEARNING_PATH.test(value) || STAFF_PATH.test(value);
}

function conversationNotificationPath(value: string): string | null {
  const [pathname, query, ...extra] = value.split('?');
  if (extra.length || !CONVERSATION_PATH.test(pathname)) return null;
  if (!query) return pathname;
  const params = new URLSearchParams(query);
  const ids = params.getAll('messageId');
  if (Array.from(params.keys()).some((key) => key !== 'messageId') || ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) return null;
  return `${pathname}?messageId=${ids[0]}`;
}

export function mobileNotificationPath(value: unknown, messageId?: unknown) {
  const anchor = typeof messageId === 'number' || typeof messageId === 'string' ? String(messageId) : '';
  const withAnchor = (path: string) => /^[1-9]\d*$/.test(anchor) && !path.includes('?') ? `${path}?messageId=${anchor}` : path;
  if (typeof value === 'string' && CONVERSATION_PATH.test(value)) return withAnchor(value);
  if (isAllowedNotificationPath(value)) return value;
  if (typeof value !== 'string') return '/updates';
  const dm = value.match(WEB_DM_PATH);
  if (dm) return withAnchor(`/conversation/dm/${dm[1]}`);
  const channel = value.match(WEB_CHANNEL_PATH);
  if (channel) return withAnchor(`/conversation/channel/${channel[1]}`);
  const announcement = value.match(WEB_ANNOUNCEMENT_PATH);
  if (announcement) return `/updates?announcement_id=${announcement[1]}`;
  const cohort = value.match(/^\/cohorts\/([1-9]\d*)$/);
  if (cohort) return `/cohort/${cohort[1]}`;
  const learning = webLearningPath(value);
  if (learning) return learning;
  if (value.startsWith('/admin/meetings')) {
    const meeting = contextPath(value.replace('/admin/meetings', '/meetings'));
    if (meeting) return meeting;
  }
  const submission = submissionPath(value, WEB_SUBMISSION_PATH);
  if (submission) return submission;
  const helpRequest = value.match(WEB_HELP_REQUEST_PATH);
  if (helpRequest) return `/staff/support/${helpRequest[1]}`;
  const intervention = value.match(WEB_INTERVENTION_PATH);
  if (intervention) return `/staff/intervention/${intervention[1]}`;
  if (/^\/lessons\/\d+$/.test(value)) return value.replace('/lessons/', '/lesson/');
  if (/^\/modules\/\d+$/.test(value)) return value.replace('/modules/', '/module/');
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

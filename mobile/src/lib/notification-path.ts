const CONVERSATION_PATH = /^\/conversation\/(channel|dm)\/\d+$/;
const WEB_CHANNEL_PATH = /^\/messages\/(\d+)$/;
const WEB_DM_PATH = /^\/messages\/dm\/(\d+)$/;
const WEB_ANNOUNCEMENT_PATH = /^\/announcements\/(\d+)$/;
const WEB_SUBMISSION_PATH = /^\/admin\/submissions\/(\d+)$/;
const WEB_HELP_REQUEST_PATH = /^\/admin\/help-requests\/(\d+)$/;
const LEARNING_PATH = /^\/(lesson|module)\/\d+$/;
const STAFF_PATH = /^\/staff\/(student|submission|support)\/\d+$/;

export function isAllowedNotificationPath(value: unknown): value is string {
  return value === '/' || value === '/learn' || value === '/resources' || value === '/recordings' || value === '/updates' || value === '/staff/grading' || value === '/staff/support' || (typeof value === 'string' && (CONVERSATION_PATH.test(value) || LEARNING_PATH.test(value) || STAFF_PATH.test(value) || /^\/recording\/[A-Za-z0-9-]+$/.test(value)));
}

export function mobileNotificationPath(value: unknown) {
  if (isAllowedNotificationPath(value)) return value;
  if (typeof value !== 'string') return '/updates';
  const dm = value.match(WEB_DM_PATH);
  if (dm) return `/conversation/dm/${dm[1]}`;
  const channel = value.match(WEB_CHANNEL_PATH);
  if (channel) return `/conversation/channel/${channel[1]}`;
  if (WEB_ANNOUNCEMENT_PATH.test(value)) return '/updates';
  const submission = value.match(WEB_SUBMISSION_PATH);
  if (submission) return `/staff/submission/${submission[1]}`;
  const helpRequest = value.match(WEB_HELP_REQUEST_PATH);
  if (helpRequest) return `/staff/support/${helpRequest[1]}`;
  if (/^\/lessons\/\d+$/.test(value)) return value.replace('/lessons/', '/lesson/');
  if (/^\/modules\/\d+$/.test(value)) return value.replace('/modules/', '/module/');
  if (value === '/dashboard') return '/';
  if (value === '/admin/grading') return '/staff/grading';
  if (value === '/admin/support') return '/staff/support';
  return '/updates';
}

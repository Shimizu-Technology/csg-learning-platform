const CONVERSATION_PATH = /^\/conversation\/(channel|dm)\/\d+$/;
const WEB_CHANNEL_PATH = /^\/messages\/(\d+)$/;
const WEB_DM_PATH = /^\/messages\/dm\/(\d+)$/;
const WEB_ANNOUNCEMENT_PATH = /^\/announcements\/(\d+)$/;
const LEARNING_PATH = /^\/(lesson|module)\/\d+$/;

export function isAllowedNotificationPath(value: unknown): value is string {
  return value === '/' || value === '/learn' || value === '/resources' || value === '/updates' || (typeof value === 'string' && (CONVERSATION_PATH.test(value) || LEARNING_PATH.test(value)));
}

export function mobileNotificationPath(value: unknown) {
  if (isAllowedNotificationPath(value)) return value;
  if (typeof value !== 'string') return '/updates';
  const dm = value.match(WEB_DM_PATH);
  if (dm) return `/conversation/dm/${dm[1]}`;
  const channel = value.match(WEB_CHANNEL_PATH);
  if (channel) return `/conversation/channel/${channel[1]}`;
  if (WEB_ANNOUNCEMENT_PATH.test(value)) return '/updates';
  if (/^\/lessons\/\d+$/.test(value)) return value.replace('/lessons/', '/lesson/');
  if (/^\/modules\/\d+$/.test(value)) return value.replace('/modules/', '/module/');
  if (value === '/dashboard') return '/';
  return '/updates';
}

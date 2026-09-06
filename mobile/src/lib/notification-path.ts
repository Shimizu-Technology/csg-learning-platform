const CONVERSATION_PATH = /^\/conversation\/(channel|dm)\/\d+$/;
const WEB_CHANNEL_PATH = /^\/messages\/(\d+)$/;
const WEB_DM_PATH = /^\/messages\/dm\/(\d+)$/;
const WEB_ANNOUNCEMENT_PATH = /^\/announcements\/(\d+)$/;
const WEB_SUBMISSION_PATH = /^\/admin\/submissions\/(\d+)$/;
const WEB_HELP_REQUEST_PATH = /^\/admin\/help-requests\/(\d+)$/;
const WEB_INTERVENTION_PATH = /^\/admin\/interventions\/(\d+)$/;
const LEARNING_PATH = /^\/(lesson|module)\/\d+$/;
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

export function isAllowedNotificationPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const staffSubmission = submissionPath(value, STAFF_SUBMISSION_PATH);
  return value === '/' || value === '/learn' || value === '/resources' || value === '/recordings' || value === '/updates' || value === '/staff/grading' || value === '/staff/support' || staffSubmission === value || CONVERSATION_PATH.test(value) || LEARNING_PATH.test(value) || STAFF_PATH.test(value) || /^\/recording\/[A-Za-z0-9-]+$/.test(value);
}

export function mobileNotificationPath(value: unknown) {
  if (isAllowedNotificationPath(value)) return value;
  if (typeof value !== 'string') return '/updates';
  const dm = value.match(WEB_DM_PATH);
  if (dm) return `/conversation/dm/${dm[1]}`;
  const channel = value.match(WEB_CHANNEL_PATH);
  if (channel) return `/conversation/channel/${channel[1]}`;
  if (WEB_ANNOUNCEMENT_PATH.test(value)) return '/updates';
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

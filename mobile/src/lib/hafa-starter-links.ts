/**
 * Hafa Code lesson starter links (see hafa-code docs/LEARN_STARTER_LINKS.md).
 *
 * Course content links to a starter without knowing the Learn lesson id. When
 * the link renders inside a lesson, Learn appends `return` (the lesson's web
 * URL) and `returnLabel` (the lesson title) to the link's hash. Hafa Code only
 * shows its lesson bar, including "Copy code for Learn", when a valid `return`
 * is present, and it only accepts https://learn.codeschoolofguam.com. Mirrors
 * the web app's `hafaStarterLinks`.
 */
export const HAFA_CODE_ORIGIN = 'https://code.shimizu-technology.com';
export const LEARN_WEB_ORIGIN = 'https://learn.codeschoolofguam.com';

export interface LessonReturn {
  url: string;
  label?: string | null;
}

function parseHafaUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== HAFA_CODE_ORIGIN || url.username || url.password) return null;
  return url;
}

function linkParams(url: URL) {
  return {
    hash: new URLSearchParams(url.hash.replace(/^#/, '')),
    query: new URLSearchParams(url.search),
  };
}

/** True for an https://code.shimizu-technology.com link that opens a project or lesson starter. */
export function isHafaStarterLink(href: string | null | undefined): href is string {
  if (!href) return false;
  const url = parseHafaUrl(href.trim());
  if (!url) return false;
  const { hash, query } = linkParams(url);
  return hash.has('project') || hash.has('starter') || query.has('project') || query.has('starter');
}

/** The web lesson URL Hafa Code's "Back to your lesson" points to. */
export function webLessonUrl(lessonId: number, cohortId?: number | null) {
  const query = cohortId && Number.isInteger(cohortId) && cohortId > 0 ? `?cohort_id=${cohortId}` : '';
  return `${LEARN_WEB_ORIGIN}/lessons/${lessonId}${query}`;
}

function cleanLabel(label: string | null | undefined) {
  // eslint-disable-next-line no-control-regex
  const value = (label ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return value ? Array.from(value).slice(0, 80).join('') : null;
}

/**
 * Adds `return` and `returnLabel` to a Hafa starter link's hash. Returns the
 * link unchanged when it is not a Hafa starter link, already names a return,
 * or the return URL is not an absolute http(s) URL.
 */
export function withLessonReturn(href: string, lessonReturn: LessonReturn | null | undefined): string {
  if (!lessonReturn || !isHafaStarterLink(href)) return href;
  const source = href.trim();
  const url = parseHafaUrl(source);
  if (!url) return href;
  const { hash, query } = linkParams(url);
  if (hash.has('return') || query.has('return')) return href;

  let returnUrl: URL;
  try {
    returnUrl = new URL(lessonReturn.url);
  } catch {
    return href;
  }
  if (returnUrl.protocol !== 'https:' && returnUrl.protocol !== 'http:') return href;

  const extra = new URLSearchParams({ return: returnUrl.href });
  const label = cleanLabel(lessonReturn.label);
  if (label) extra.set('returnLabel', label);

  // Append rather than re-serialize so the project payload stays byte-for-byte intact.
  const hashIndex = source.indexOf('#');
  const base = hashIndex === -1 ? source : source.slice(0, hashIndex);
  const existing = hashIndex === -1 ? '' : source.slice(hashIndex + 1).replace(/&+$/, '');
  return `${base}#${existing ? `${existing}&` : ''}${extra.toString()}`;
}

export const DEFAULT_STARTER_LABEL = 'Open starter in Hafa Code';

/** Hints under the starter button: the learner returns with Done, not Hafa's web link. */
export const STARTER_HINTS = {
  submit: 'Run it there, tap Copy code for Learn, then tap Done and paste it here.',
  practice: 'Run it there and try a change. Tap Done to come back to this lesson.',
} as const;

export type StarterHint = keyof typeof STARTER_HINTS;

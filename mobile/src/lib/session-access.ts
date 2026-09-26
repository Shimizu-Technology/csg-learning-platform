import { ApiError } from './api';
import type { SessionEnrollment, SessionUser } from './types';

const ACCESS_DENIED_CODES = new Set(['account_not_authorized', 'account_archived']);
const SESSION_CACHE_VERSION = 3;

interface CachedSession {
  version: typeof SESSION_CACHE_VERSION;
  subject: string;
  user: SessionUser;
  enrollments: SessionEnrollment[];
}

export interface CachedSessionData {
  user: SessionUser;
  enrollments: SessionEnrollment[];
}

function nullableString(value: unknown) {
  return value === null || typeof value === 'string';
}

function validCommunityPolicy(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const policy = value as Record<string, unknown>;
  return typeof policy.version === 'string'
    && typeof policy.accepted === 'boolean'
    && nullableString(policy.accepted_at)
    && typeof policy.privacy_url === 'string'
    && typeof policy.terms_url === 'string'
    && typeof policy.deletion_url === 'string';
}

export function isSessionAccessDenied(error: unknown) {
  return error instanceof ApiError
    && error.status === 403
    && Boolean(error.code && ACCESS_DENIED_CODES.has(error.code));
}

export function canUseCachedSession(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  return error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500;
}

function validSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  if (!Number.isInteger(user.id) || (user.id as number) <= 0) return false;
  if (!['full_name', 'email', 'role', 'clerk_id', 'first_name', 'last_name'].every((field) => typeof user[field] === 'string')) return false;
  if (!nullableString(user.avatar_url) || !nullableString(user.github_username)) return false;
  if (typeof user.is_admin !== 'boolean' || typeof user.is_staff !== 'boolean') return false;
  return validCommunityPolicy(user.community_policy);
}

function validSessionEnrollment(value: unknown): value is SessionEnrollment {
  if (!value || typeof value !== 'object') return false;
  const enrollment = value as Record<string, unknown>;
  if (!Number.isInteger(enrollment.id) || (enrollment.id as number) <= 0) return false;
  if (typeof enrollment.status !== 'string' || !nullableString(enrollment.enrolled_at)) return false;
  if (!enrollment.cohort || typeof enrollment.cohort !== 'object') return false;
  const cohort = enrollment.cohort as Record<string, unknown>;
  return Number.isInteger(cohort.id)
    && (cohort.id as number) > 0
    && ['name', 'cohort_type', 'start_date', 'status'].every((field) => typeof cohort[field] === 'string');
}

function validSessionEnrollments(value: unknown): value is SessionEnrollment[] {
  return Array.isArray(value) && value.every(validSessionEnrollment);
}

export function serializeCachedSession(user: SessionUser, enrollments: SessionEnrollment[], subject: string) {
  const session: CachedSession = { version: SESSION_CACHE_VERSION, subject, user, enrollments };
  return JSON.stringify(session);
}

export function parseCachedSession(value: string, expectedSubject: string): CachedSessionData | null {
  if (!expectedSubject) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const cached = parsed as Record<string, unknown>;

    if (cached.version === SESSION_CACHE_VERSION) {
      return cached.subject === expectedSubject
        && validSessionUser(cached.user)
        && validSessionEnrollments(cached.enrollments)
        ? { user: cached.user, enrollments: cached.enrollments }
        : null;
    }

    if (cached.version === 2) {
      return cached.subject === expectedSubject && validSessionUser(cached.user)
        ? { user: cached.user, enrollments: [] }
        : null;
    }

    // Build 15 and earlier stored the user object directly. That legacy cache
    // is safe to migrate only when its persisted Clerk id matches the subject.
    return validSessionUser(parsed) && parsed.clerk_id === expectedSubject
      ? { user: parsed, enrollments: [] }
      : null;
  } catch {
    return null;
  }
}

export function serializeCachedSessionUser(user: SessionUser, subject: string) {
  return serializeCachedSession(user, [], subject);
}

export function parseCachedSessionUser(value: string, expectedSubject: string): SessionUser | null {
  return parseCachedSession(value, expectedSubject)?.user || null;
}

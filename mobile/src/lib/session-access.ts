import { ApiError } from './api';
import type { SessionUser } from './types';

const ACCESS_DENIED_CODES = new Set(['account_not_authorized', 'account_archived']);
const SESSION_CACHE_VERSION = 2;

interface CachedSession {
  version: typeof SESSION_CACHE_VERSION;
  subject: string;
  user: SessionUser;
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

export function serializeCachedSessionUser(user: SessionUser, subject: string) {
  const session: CachedSession = { version: SESSION_CACHE_VERSION, subject, user };
  return JSON.stringify(session);
}

export function parseCachedSessionUser(value: string, expectedSubject: string): SessionUser | null {
  if (!expectedSubject) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const cached = parsed as Record<string, unknown>;

    if (cached.version === SESSION_CACHE_VERSION) {
      return cached.subject === expectedSubject && validSessionUser(cached.user) ? cached.user : null;
    }

    // Build 15 and earlier stored the user object directly. That legacy cache
    // is safe to migrate only when its persisted Clerk id matches the subject.
    return validSessionUser(parsed) && parsed.clerk_id === expectedSubject ? parsed : null;
  } catch {
    return null;
  }
}

import { ApiError } from './api';
import type { SessionUser } from './types';

const ACCESS_DENIED_CODES = new Set(['account_not_authorized', 'account_archived']);

function nullableString(value: unknown) {
  return value === null || typeof value === 'string';
}

function validCommunityPolicy(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
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

export function parseCachedSessionUser(value: string): SessionUser | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const user = parsed as Record<string, unknown>;
    if (!Number.isInteger(user.id) || (user.id as number) <= 0) return null;
    if (!['full_name', 'email', 'role', 'clerk_id', 'first_name', 'last_name'].every((field) => typeof user[field] === 'string')) return null;
    if (!nullableString(user.avatar_url) || !nullableString(user.github_username)) return null;
    if (typeof user.is_admin !== 'boolean' || typeof user.is_staff !== 'boolean') return null;
    if (!validCommunityPolicy(user.community_policy)) return null;
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

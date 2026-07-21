import { ApiError } from './api';

const ACCESS_DENIED_CODES = new Set(['account_not_authorized', 'account_archived']);

export function isSessionAccessDenied(error: unknown) {
  return error instanceof ApiError
    && error.status === 403
    && Boolean(error.code && ACCESS_DENIED_CODES.has(error.code));
}

export function canUseCachedSession(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  return error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500;
}

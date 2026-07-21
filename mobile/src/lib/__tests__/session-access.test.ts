import { ApiError } from '../api';
import { canUseCachedSession, isSessionAccessDenied } from '../session-access';

describe('session access errors', () => {
  it('recognizes explicit invite-only and archived account denials', () => {
    expect(isSessionAccessDenied(new ApiError('No access', 403, 'account_not_authorized'))).toBe(true);
    expect(isSessionAccessDenied(new ApiError('Archived', 403, 'account_archived'))).toBe(true);
  });

  it('never treats authentication or authorization errors as offline cache fallbacks', () => {
    expect(canUseCachedSession(new ApiError('Unauthorized', 401))).toBe(false);
    expect(canUseCachedSession(new ApiError('Forbidden', 403))).toBe(false);
  });

  it('allows a saved session only for connectivity and transient server failures', () => {
    expect(canUseCachedSession(new ApiError('Offline'))).toBe(true);
    expect(canUseCachedSession(new ApiError('Unavailable', 503))).toBe(true);
  });
});

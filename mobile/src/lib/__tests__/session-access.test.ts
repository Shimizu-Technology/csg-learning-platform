import { ApiError } from '../api';
import { canUseCachedSession, isSessionAccessDenied, parseCachedSessionUser } from '../session-access';

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

  it('accepts only cached session objects with a positive integer user id', () => {
    const validUser = {
      id: 7,
      full_name: 'Student One',
      email: 'student@example.com',
      role: 'student',
      avatar_url: null,
      is_admin: false,
      is_staff: false,
      clerk_id: 'clerk_student',
      first_name: 'Student',
      last_name: 'One',
      github_username: null,
    };
    expect(parseCachedSessionUser(JSON.stringify(validUser))?.id).toBe(7);
    expect(parseCachedSessionUser('{"id":0}')).toBeNull();
    expect(parseCachedSessionUser('{"id":-1}')).toBeNull();
    expect(parseCachedSessionUser('{"id":7.5}')).toBeNull();
    expect(parseCachedSessionUser('{"id":"7"}')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, email: undefined }))).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, is_staff: 'false' }))).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, community_policy: { version: '1' } }))).toBeNull();
    expect(parseCachedSessionUser('null')).toBeNull();
    expect(parseCachedSessionUser('{malformed')).toBeNull();
  });
});

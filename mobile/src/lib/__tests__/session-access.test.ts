import { ApiError } from '../api';
import { canUseCachedSession, isSessionAccessDenied, parseCachedSession, parseCachedSessionUser, serializeCachedSession, serializeCachedSessionUser } from '../session-access';
import type { SessionEnrollment } from '../types';

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
    expect(parseCachedSessionUser(JSON.stringify(validUser), 'clerk_student')?.id).toBe(7);
    expect(parseCachedSessionUser('{"id":0}', 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser('{"id":-1}', 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser('{"id":7.5}', 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser('{"id":"7"}', 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, email: undefined }), 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, is_staff: 'false' }), 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, community_policy: { version: '1' } }), 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify({ ...validUser, community_policy: null }), 'clerk_student')?.id).toBe(7);
    expect(parseCachedSessionUser('null', 'clerk_student')).toBeNull();
    expect(parseCachedSessionUser('{malformed', 'clerk_student')).toBeNull();
  });

  it('binds versioned cached sessions to the authenticated subject instead of the legacy Clerk id', () => {
    const bridgedUser = {
      id: 7,
      full_name: 'Student One',
      email: 'student@example.com',
      role: 'student',
      avatar_url: null,
      is_admin: false,
      is_staff: false,
      clerk_id: 'legacy_clerk_student',
      first_name: 'Student',
      last_name: 'One',
      github_username: null,
    } as const;
    const cached = serializeCachedSessionUser(bridgedUser, 'production_clerk_student');

    expect(parseCachedSessionUser(cached, 'production_clerk_student')).toEqual(bridgedUser);
    expect(parseCachedSessionUser(cached, 'different_clerk_student')).toBeNull();
    expect(parseCachedSessionUser(JSON.stringify(bridgedUser), 'production_clerk_student')).toBeNull();
  });

  it('round trips enrollments needed for offline navigation', () => {
    const user = {
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
    } as const;
    const enrollments: SessionEnrollment[] = [{
      id: 12,
      cohort: { id: 4, name: 'CSG Alumni', cohort_type: 'alumni', start_date: '2026-09-01', status: 'active' },
      status: 'active',
      enrolled_at: '2026-09-01T00:00:00Z',
    }];

    const cached = serializeCachedSession(user, enrollments, 'clerk_student');

    expect(parseCachedSession(cached, 'clerk_student')).toEqual({ user, enrollments });
    expect(parseCachedSession(cached, 'different_subject')).toBeNull();
  });
});

import type { components } from '../types/api.generated';
import type { GradingScale } from './gradingScale';
import type {
  VideoProgressInput,
  WatchProgressInput,
} from '../types/api'
import {
  notifyUnreadChanged,
  unreadRefreshVersion,
} from './unread'
import type {
  CourseOutlineResponse,
  MyWorkResponse,
  MessageDestination,
  ThreadWindowOptions,
  ActivityEventsResponse,
  SessionResponse,
  DashboardResponse,
  WeeklyPlanResponse,
  RecordingsResponse,
  ResourcesResponse,
  ProfileResponse,
  ProfileUpdateResponse,
  ModuleResponse,
  LessonResponse,
  LessonBlockEditorResponse,
  LessonBlockEditorInput,
  ProgressUpdateResponse,
  SubmissionsListResponse,
  GradingQueueResponse,
  SubmissionResponse,
  StudentProgressResponse,
  UsersListResponse,
  UserDetailResponse,
  UserUpdateResponse,
  CurriculaListResponse,
  CurriculumResponse,
  CohortsListResponse,
  CohortResponse,
  AccessibleCohortsResponse,
  CohortHomeResponse,
  CohortInstructorAssignmentsResponse,
  CohortStudentViewResponse,
  SubmissionWindowsResponse,
  OfficeHoursResponse,
  OfficeHourResponse,
  PrivateMeetingsResponse,
  StaffPrivateMeetingsResponse,
  EnrollmentResponse,
  ModuleAssignmentsListResponse,
  ModuleAssignmentResponse,
  LessonAssignmentsListResponse,
  LessonAssignmentResponse,
  ContentBlockResponse,
  ContentBlocksListResponse,
  CohortRecordingsResponse,
  RecordingResponse,
  ReorderRecordingsResponse,
  VideoStreamResponse,
  VideoProgressResponse,
  WatchProgressUpdateResponse,
  CohortWatchProgressResponse,
  CohortLessonVideoProgressResponse,
  StudentWatchProgressResponse,
  StudentLessonVideoProgressResponse,
  AnnouncementsResponse,
  AnnouncementResponse,
  NotificationsResponse,
  NotificationResponse,
  MarkAllNotificationsReadResponse,
  MessageNotificationPreferenceResponse,
  PushConfigResponse,
  WebPushNotificationPreferenceResponse,
  PushSubscriptionResponse,
  CableTokenResponse,
  WorkspacesResponse,
  WorkspaceResponse,
  ChannelsResponse,
  ChannelResponse,
  MessageResponse,
  MessageSourceType,
  DirectConversationsResponse,
  DirectConversationResponse,
  AvailableDirectUsersResponse,
  MessageAttachmentPresignResponse,
  MessagePreferenceResponse,
  EditorPreferencesInput,
  EditorPreferencesResponse,
  MessageSearchResponse,
  HelpRequestsResponse,
  HelpRequestResponse,
  HelpRequestReplyResponse,
  SupportQueueResponse,
  HelpCategory,
  HelpContextSource,
  HelpContextType,
  HelpUrgency,
  InterventionsResponse,
  InterventionResponse,
  InterventionStatus,
  InterventionOutcome,
  InterventionSeverity,
  InterventionTrigger,
  RecoveryPlansResponse,
  RecoveryPlanResponse,
  LearningInsightsResponse,
  GithubChecksResponse,
} from '../types/api';

export interface GradingQueueParams {
  cohort_id?: number | null
  filter?: 'ungraded' | 'redo' | 'all'
  module_id?: number | null
  student_id?: number | null
  lesson_id?: number | null
  suggestion_outcome?: 'suggest_b' | 'suggest_pass' | 'review_for_redo' | 'no_suggestion' | 'stale_evidence' | null
  sort?: 'oldest' | 'newest'
  page?: number | null
  per_page?: number | null
  focus_id?: number | null
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 12_000;
export const CURRICULUM_COPY_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const CACHE_FALLBACK_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const CACHE_PREFIX = 'csg-api-cache:';
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

type AuthTokenGetter = (forceRefresh?: boolean) => Promise<string | null>;

let getAuthToken: AuthTokenGetter | null = null;
let apiCacheScope: string | null = null;

export function setAuthTokenGetter(getter: AuthTokenGetter) {
  getAuthToken = getter;
}

export function setApiCacheScope(scope: string | null) {
  apiCacheScope = scope;
}

export function clearApiCache(scope = apiCacheScope) {
  if (!scope) return;

  try {
    const scopedPrefix = `${CACHE_PREFIX}${scope}:`;
    const invalidScopePrefix = `${CACHE_PREFIX}null:`;
    Object.keys(localStorage)
      .filter((key) => key.startsWith(scopedPrefix) || key.startsWith(invalidScopePrefix))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in private browsing or locked-down WebViews.
  }
}

export type ApiErrorKind = 'auth' | 'forbidden' | 'not_found' | 'server' | 'network' | 'timeout' | 'unknown';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status?: number;
  errorKind?: ApiErrorKind;
  errorCode?: string;
  /** Blocks an error is about, e.g. the videos a save would reset watch progress on (confirm_watch_reset). */
  errorBlockIds?: number[];
  errorCompletionImpact?: components['schemas']['LessonCompletionImpact'];
  /** The move's impact now, with code impact_changed (POST /lessons/:id/move). */
  errorImpact?: components['schemas']['LessonMoveImpact'];
  latestSubmissionId?: number;
  /** Items a batch grade skipped, when none could be graded (POST /submissions/batch_grade, 422). */
  errorSkipped?: components['schemas']['BatchGradeSkippedItem'][];
  fromCache?: boolean;
  cacheAgeMs?: number;
}

// Layout and Messages often refresh together. Share only pending list reads,
// scoped by account and signal version so a post-mutation read stays fresh.
const unreadListRequests = new Map<string, Promise<ApiResponse<unknown>>>();
function fetchUnreadList<T>(endpoint: string): Promise<ApiResponse<T>> {
  const key = JSON.stringify([apiCacheScope, unreadRefreshVersion(), endpoint]);
  const pending = unreadListRequests.get(key);
  if (pending) return pending as Promise<ApiResponse<T>>;
  const request = fetchApi<T>(endpoint).finally(() => { unreadListRequests.delete(key); });
  unreadListRequests.set(key, request);
  return request;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth: boolean = true,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<ApiResponse<T>> {
  const method = (options.method || 'GET').toUpperCase();
  const canRetry = method === 'GET' || method === 'HEAD';
  const cacheScope = apiCacheScope;
  const canUseCache = requireAuth && method === 'GET' && options.cache !== 'no-store' && Boolean(cacheScope);
  const maxAttempts = canRetry ? 3 : 2;
  let shouldForceTokenRefresh = false;
  let didRetryUnauthorized = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (requireAuth && getAuthToken) {
      const token = await getAuthToken(shouldForceTokenRefresh);
      shouldForceTokenRefresh = false;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      try {
        const cohortId = globalThis.localStorage?.getItem('csg-selected-course-id');
        if (cohortId && /^\d+$/.test(cohortId)) headers['X-CSG-Cohort-Id'] = cohortId;
      } catch {
        // Storage may be unavailable in a private browser.
      }
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      }, timeoutMs);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const error = errorMessage(errorBody, response.status);
        const errorCode = apiErrorCode(errorBody);
        const retryUnauthorized = response.status === 401 && !didRetryUnauthorized;
        const retryTransient = canRetry && RETRYABLE_STATUSES.has(response.status);

        if (retryUnauthorized && attempt < maxAttempts) {
          didRetryUnauthorized = true;
          shouldForceTokenRefresh = true;
          await waitForRetry(attempt);
          continue;
        }

        if (retryTransient && attempt < maxAttempts) {
          await waitForRetry(attempt);
          continue;
        }

        if (canUseCache && CACHE_FALLBACK_STATUSES.has(response.status)) {
          const cached = readCachedResponse<T>(cacheScope, endpoint);
          if (cached) {
            return { ...cached, error, errorCode, status: response.status, errorKind: errorKindForStatus(response.status) };
          }
        }

        return {
          data: null,
          error,
          errorCode,
          latestSubmissionId: typeof errorBody.latest_submission_id === 'number' ? errorBody.latest_submission_id : undefined,
          errorSkipped: Array.isArray(errorBody.skipped) ? errorBody.skipped : undefined,
          errorBlockIds: Array.isArray(errorBody.block_ids) ? errorBody.block_ids.filter((id: unknown): id is number => typeof id === 'number') : undefined,
          errorCompletionImpact: errorBody.completion_impact,
          errorImpact: errorBody.impact && typeof errorBody.impact === 'object' ? errorBody.impact : undefined,
          status: response.status,
          errorKind: errorKindForStatus(response.status),
        };
      }

      if (response.status === 204) {
        return { data: null, error: null, status: response.status };
      }

      const text = await response.text();
      if (!text) {
        return { data: null, error: null, status: response.status };
      }

      const data = JSON.parse(text) as T;
      if (method === 'PATCH' && endpoint === '/api/v1/dashboard/start_here' && (data as { dismissed?: boolean }).dismissed === true) {
        invalidateDashboardCache(cacheScope);
      }
      if ((method !== 'GET' && /\/api\/v1\/(notifications|channels|direct_conversations)\/.*read/.test(endpoint)) ||
          (method !== 'GET' && endpoint === '/api/v1/message_preferences') ||
          (method === 'GET' && /^\/api\/v1\/announcements\/\d+$/.test(endpoint))) {
        invalidateUnreadCache(cacheScope);
        notifyUnreadChanged();
      }
      if (canUseCache && shouldCacheResponse(endpoint, data)) writeCachedResponse(cacheScope, endpoint, data);
      return { data, error: null, status: response.status };
    } catch (err) {
      // The caller canceled (a peek card's pointer left): don't retry or fall back to a cached copy.
      if (options.signal?.aborted) return { data: null, error: 'Request canceled', errorKind: 'unknown' };
      const kind = err instanceof DOMException && err.name === 'AbortError' ? 'timeout' : 'network';
      const message = kind === 'timeout' ? 'Request timed out. Check your connection and try again.' : networkErrorMessage(err);

      if (canRetry && attempt < maxAttempts) {
        await waitForRetry(attempt);
        continue;
      }

      if (canUseCache) {
        const cached = readCachedResponse<T>(cacheScope, endpoint);
        if (cached) {
          return { ...cached, error: message, errorKind: kind };
        }
      }

      return {
        data: null,
        error: message,
        errorKind: kind,
      };
    }
  }

  return { data: null, error: 'Request failed', errorKind: 'unknown' };
}

/** A folder ZIP needs time to build and stream; it is never retried or cached. */
const ZIP_TIMEOUT_MS = 120_000;

/**
 * Downloads an authenticated binary response (a folder ZIP) as a Blob, with
 * the filename the API named in Content-Disposition. Errors come back as the
 * API's JSON message, like fetchApi.
 */
async function fetchBlob(endpoint: string): Promise<ApiResponse<{ blob: Blob; filename: string }>> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const headers: Record<string, string> = {};
    const token = getAuthToken ? await getAuthToken(attempt > 1) : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, { headers, cache: 'no-store' }, ZIP_TIMEOUT_MS);
      if (response.status === 401 && attempt === 1) continue;
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return { data: null, error: errorMessage(errorBody, response.status), status: response.status, errorKind: errorKindForStatus(response.status) };
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'files.zip';
      return { data: { blob: await response.blob(), filename }, error: null, status: response.status };
    } catch (err) {
      const kind = err instanceof DOMException && err.name === 'AbortError' ? 'timeout' : 'network';
      return { data: null, error: kind === 'timeout' ? 'The download timed out. Try one folder at a time.' : networkErrorMessage(err), errorKind: kind };
    }
  }
  return { data: null, error: 'Request failed', errorKind: 'auth', status: 401 };
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;

  if (externalSignal?.aborted) controller.abort();
  const abortFromExternalSignal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  });
}

function errorMessage(errorBody: unknown, status: number) {
  if (errorBody && typeof errorBody === 'object') {
    const body = errorBody as { error?: unknown; errors?: unknown };
    if (typeof body.error === 'string') return body.error;
    if (Array.isArray(body.errors)) return body.errors.join(', ');
  }

  return `Request failed with status ${status}`;
}

function apiErrorCode(errorBody: unknown) {
  if (!errorBody || typeof errorBody !== 'object') return undefined;
  const code = (errorBody as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'unknown';
}

function networkErrorMessage(err: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You appear to be offline. Showing saved data when available.';
  }

  return err instanceof Error ? err.message : 'Network error';
}

function waitForRetry(attempt: number) {
  const jitter = Math.floor(Math.random() * 250);
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 400 * attempt * attempt + jitter);
  });
}

function invalidateDashboardCache(scope: string | null) {
  if (!scope) return;
  try {
    const prefix = `${CACHE_PREFIX}${scope}:`;
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(prefix) && /^\/api\/v1\/dashboard(?:\?|$)/.test(key.slice(prefix.length))) localStorage.removeItem(key);
    });
  } catch { /* Storage may be unavailable; the successful dismissal still stands. */ }
}

function invalidateUnreadCache(scope: string | null) {
  if (!scope) return;
  try {
    const prefix = `${CACHE_PREFIX}${scope}:`;
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(prefix) && /^\/api\/v1\/(announcements|notifications|dashboard|channels|direct_conversations)(?:\?|$)/.test(key.slice(prefix.length))) localStorage.removeItem(key);
    });
  } catch { /* Storage may be unavailable. Live observers still refresh. */ }
}

function cacheKey(scope: string | null, endpoint: string) {
  return `${CACHE_PREFIX}${scope}:${endpoint}`;
}

function writeCachedResponse<T>(scope: string | null, endpoint: string, data: T) {
  if (!scope) return;

  try {
    localStorage.setItem(cacheKey(scope, endpoint), JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Storage can be unavailable in private browsing or locked-down WebViews.
  }
}

function shouldCacheResponse<T>(endpoint: string, data: T) {
  if (!data || typeof data !== 'object') return false;
  if (endpoint.startsWith('/api/v1/help_requests') || endpoint === '/api/v1/support_queue') return false;

  const path = endpoint.split('?')[0];

  if (path === '/api/v1/dashboard') {
    const dashboard = (data as { dashboard?: { enrolled?: boolean } }).dashboard;
    return typeof dashboard?.enrolled === 'boolean';
  }

  if (path === '/api/v1/resources') {
    const resources = (data as { resources?: unknown[] }).resources;
    return Array.isArray(resources);
  }

  if (endpoint === '/api/v1/recordings') {
    const response = data as { recordings?: unknown[]; s3_recordings?: unknown[] };
    return Array.isArray(response.recordings) || Array.isArray(response.s3_recordings);
  }

  if (/^\/api\/v1\/lessons\/\d+$/.test(endpoint)) {
    const updatedAt = (data as { lesson?: { updated_at?: unknown } }).lesson?.updated_at;
    return typeof updatedAt === 'string' && updatedAt.length > 0;
  }

  return true;
}

function readCachedResponse<T>(scope: string | null, endpoint: string): ApiResponse<T> | null {
  if (!scope) return null;

  try {
    const raw = localStorage.getItem(cacheKey(scope, endpoint));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: T; savedAt?: number };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    if (!shouldCacheResponse(endpoint, parsed.data as T)) return null;

    return {
      data: parsed.data ?? null,
      error: null,
      fromCache: true,
      cacheAgeMs: Date.now() - parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function queryString(params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return '';

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// Course files contain literal shell/SQL/HTML teaching examples. Transport the
// UTF-8 file as base64; the API decodes and applies the same bounded validation.
function coursePackageBody(packageData: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(packageData))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return JSON.stringify({ package_base64: btoa(binary) })
}

export type PublicCourse = components['schemas']['PublicCourse'];
export type FeatureSettingsData = components['schemas']['FeatureSettingsData'];
export type FeatureSwitchChangesResponse = components['schemas']['FeatureSwitchChangesResponse'];
export type SchoolIdentityResponse = components['schemas']['SchoolIdentityResponse'];
export type CohortGithubSyncHealthResponse = components['schemas']['CohortGithubSyncHealthResponse'];
export type BulkEnrollmentResult = { row: number; email: string; status: string; user_id?: number; enrollment_id?: number; error?: string; invitation_status?: string | null }
export type BulkEnrollmentState = { enrolled: number; invited: number; results: BulkEnrollmentResult[] }
export const api = {
  verifyCertificate: (code: string) =>
    fetchApi<components['schemas']['CertificateVerificationResponse']>(`/api/v1/certificates/${encodeURIComponent(code)}`, { cache: 'no-store' }, false),
  updateCertificateName: (enrollmentId: number, holderName: string) =>
    fetchApi<components['schemas']['CertificateVerificationResponse']>(`/api/v1/enrollments/${enrollmentId}/certificate`, {
      method: 'PATCH', body: JSON.stringify({ holder_name: holderName }),
    }),
  manageCertificate: (enrollmentId: number, action: 'revoke' | 'reissue', reason: string) =>
    fetchApi<components['schemas']['CertificateVerificationResponse']>(`/api/v1/enrollments/${enrollmentId}/certificate/${action}`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  getSubmissionAudit: () => fetchApi<components['schemas']['SubmissionAuditResponse']>('/api/v1/submission_audits', { cache: 'no-store' }),
  reviewSubmissionAudit: (id: number, content_digest: string) => fetchApi<components['schemas']['SubmissionAuditReviewResponse']>(`/api/v1/submission_audits/${id}`, { method: 'PATCH', body: JSON.stringify({ content_digest }) }),
  getSetupReadiness: (id: number, data: Record<string, unknown> = {}) => fetchApi<{ readiness: Record<string, boolean>; school_checkout: { enabled: boolean; stripe_configured: boolean; webhook_configured: boolean }; errors: string[] }>(`/api/v1/cohorts/${id}/setup_readiness`, { method: 'POST', body: JSON.stringify(data), cache: 'no-store' }),
  verifyOfferingPrice: (id: number) =>
    fetchApi<components['schemas']['OfferingPriceVerificationResponse']>(`/api/v1/cohorts/${id}/verify_offering_price`, { method: 'POST' }),
  bulkEnroll: async (id: number, rows: Array<{ email: string; first_name?: string; last_name?: string }>, sendInvite: boolean, onProgress?: (count: number, phase: 'enrolling' | 'inviting') => void, resume?: BulkEnrollmentState) => {
    const state = resume || { enrolled: 0, invited: 0, results: [] }
    const request = (batch: typeof rows, dispatch: boolean) => fetchApi<{ results: BulkEnrollmentResult[] }>(`/api/v1/cohorts/${id}/enrollments/bulk`, { method: 'POST', body: JSON.stringify({ rows: batch, send_invite: dispatch, dispatch_only: dispatch }) }, true, 30_000)
    for (; state.enrolled < rows.length;) {
      const offset = state.enrolled
      onProgress?.(offset, 'enrolling')
      const response = await request(rows.slice(offset, offset + 25), false)
      if (!response.data || response.error) return { ...response, resume: state }
      state.results.push(...response.data.results.map(r => ({ ...r, row: r.row + offset })))
      state.enrolled = Math.min(offset + 25, rows.length)
      onProgress?.(state.enrolled, 'enrolling')
    }
    const eligible = state.results.filter(r => r.status === 'enrolled' || r.status === 'already_enrolled')
    if (sendInvite) for (; state.invited < eligible.length;) {
      const offset = state.invited
      onProgress?.(offset, 'inviting')
      const response = await request(eligible.slice(offset, offset + 3).map(r => ({ email: r.email })), true)
      if (!response.data || response.error) return { ...response, resume: state }
      response.data.results.forEach((r, i) => Object.assign(eligible[offset + i], { invitation_status: r.invitation_status, error: r.error }))
      state.invited = Math.min(offset + 3, eligible.length)
      onProgress?.(state.invited, 'inviting')
    }
    return { data: { results: state.results }, resume: undefined } as ApiResponse<{ results: BulkEnrollmentResult[] }> & { resume?: BulkEnrollmentState }
  },

  getFeatureSettings: (cohortId?: number) => fetchApi<FeatureSettingsData>(cohortId ? `/api/v1/cohorts/${cohortId}/feature_settings` : '/api/v1/feature_settings', { cache: 'no-store' }),
  getFeatureSwitchChanges: (cohortId?: number) => fetchApi<FeatureSwitchChangesResponse>(cohortId ? `/api/v1/cohorts/${cohortId}/feature_settings/changes` : '/api/v1/feature_settings/changes', { cache: 'no-store' }),
  saveFeatureSettings: (data: { features?: Record<string, boolean | null>; public_catalog_mode?: string; review_response_time?: string | null }, cohortId?: number) => fetchApi<FeatureSettingsData>(cohortId ? `/api/v1/cohorts/${cohortId}/feature_settings` : '/api/v1/feature_settings', { method: 'PATCH', body: JSON.stringify(data) }),
  getSchoolIdentity: () => fetchApi<SchoolIdentityResponse>('/api/v1/school_identity', { cache: 'no-store' }),
  // Auth
  getCourseOfferings: () =>
    fetchApi<{ public_catalog_mode?: 'automatic' | 'always' | 'hidden'; offerings: PublicCourse[] }>('/api/v1/course_offerings', {}, false),
  getCourseOffering: (slug: string) => fetchApi<{ offering: PublicCourse }>(`/api/v1/course_offerings/${encodeURIComponent(slug)}`, {}, false),
  dismissStartHere: (cohortId: number) => fetchApi<{ dismissed: boolean }>('/api/v1/dashboard/start_here', { method: 'PATCH', body: JSON.stringify({ cohort_id: cohortId }) }),
  getCourseReceipt: (id: number) => fetchApi<{ url: string }>(`/api/v1/course_checkouts/${id}/receipt`, { cache: 'no-store' }),
  getCourseCheckoutStatus: (id: string | number) =>
    fetchApi<{ status: 'pending' | 'starting' | 'setup_failed' | 'fulfilled' | 'failed' | 'refunded'; can_resume?: boolean; can_continue?: boolean; purchase_id: number; cohort: { id: number; name: string; slug?: string | null; unlisted?: boolean }; enrollment_id: number | null }>(`/api/v1/course_checkouts/${encodeURIComponent(id)}/status`, { cache: 'no-store' }, true, 10_000),
  getPendingCoursePurchases: () =>
    fetchApi<{ purchases: Array<{ id: number; cohort_id: number }> }>('/api/v1/course_checkouts', { cache: 'no-store' }),
  startCourseCheckout: (cohortId: number) =>
    fetchApi<{ url: string }>('/api/v1/course_checkouts', { method: 'POST', body: JSON.stringify({ cohort_id: cohortId }) }),
  createSession: () =>
    fetchApi<SessionResponse>('/api/v1/sessions', { method: 'POST' }),
  updatePresence: () =>
    fetchApi<{ last_seen_at: string }>('/api/v1/presence', { method: 'POST' }),

  // Dashboard
  getDashboard: (cohortId?: number) =>
    fetchApi<DashboardResponse>(`/api/v1/dashboard${queryString({ cohort_id: cohortId })}`),
  getWeeklyPlan: (cohortId?: number) =>
    fetchApi<WeeklyPlanResponse>(`/api/v1/weekly_plan${queryString({ cohort_id: cohortId })}`),
  /** Learn's course outline (redesigned student experience). Staff pass `studentId` to view one enrolled learner's. */
  getCourseOutline: (cohortId?: number | null, studentId?: number | null) =>
    fetchApi<CourseOutlineResponse>(`/api/v1/course_outline${queryString({ cohort_id: cohortId, student_id: studentId })}`),
  /** My work: the learner's own redos, work waiting for review and graded work in one cohort. */
  getMyWork: (cohortId?: number | null) =>
    fetchApi<MyWorkResponse>(`/api/v1/my_work${queryString({ cohort_id: cohortId })}`),
  getRecordings: (cohortId?: number) =>
    fetchApi<RecordingsResponse>(`/api/v1/recordings${queryString({ cohort_id: cohortId })}`),
  getResources: (cohortId?: number) =>
    fetchApi<ResourcesResponse>(`/api/v1/resources${queryString({ cohort_id: cohortId, include_course_files: true })}`),
  getCurriculumResources: (curriculumId: number) =>
    fetchApi<ResourcesResponse>(`/api/v1/curricula/${curriculumId}/resources`),
  createCurriculumResource: (curriculumId: number, data: { title: string; filename: string; file_size: number }) =>
    fetchApi<{ resource: { download_id: number }; upload_url: string; fields: Record<string, string> }>(`/api/v1/curricula/${curriculumId}/resources`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  completeCurriculumResource: (curriculumId: number, resourceId: number) =>
    fetchApi<{ resource: unknown }>(`/api/v1/curricula/${curriculumId}/resources/${resourceId}/complete`, { method: 'POST' }),
  abandonCurriculumResource: (curriculumId: number, resourceId: number) =>
    fetchApi<null>(`/api/v1/curricula/${curriculumId}/resources/${resourceId}`, { method: 'DELETE' }),
  downloadCurriculumResource: (curriculumId: number, resourceId: number) =>
    fetchApi<{ url: string; expires_in: number }>(`/api/v1/curricula/${curriculumId}/resources/${resourceId}/download`, { method: 'POST' }),
  // Class files and private student folders. Never cached: folders are private and links expire.
  getCohortFiles: (cohortId: number) =>
    fetchApi<components['schemas']['CohortFilesResponse']>(`/api/v1/cohorts/${cohortId}/files`, { cache: 'no-store' }),
  createCohortFile: (cohortId: number, data: components['schemas']['CohortFileUploadInput']) =>
    fetchApi<components['schemas']['CohortFileUploadResponse']>(`/api/v1/cohorts/${cohortId}/files`, { method: 'POST', body: JSON.stringify(data) }),
  /** Links are saved ready in one step and work without file storage. */
  createCohortLink: (cohortId: number, data: Omit<components['schemas']['CohortLinkCreateInput'], 'kind'>) =>
    fetchApi<components['schemas']['CohortFileResponse']>(`/api/v1/cohorts/${cohortId}/files`, { method: 'POST', body: JSON.stringify({ ...data, kind: 'link' }) }),
  completeCohortFile: (cohortId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortFileResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/complete`, { method: 'POST' }),
  updateCohortFile: (cohortId: number, fileId: number, data: components['schemas']['CohortFileUpdateInput']) =>
    fetchApi<components['schemas']['CohortFileResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  /** `pendingOnly` abandons an unfinished upload and is refused once the file is published. */
  deleteCohortFile: (cohortId: number, fileId: number, options: { pendingOnly?: boolean } = {}) =>
    fetchApi<null>(`/api/v1/cohorts/${cohortId}/files/${fileId}${options.pendingOnly ? '?pending_only=true' : ''}`, { method: 'DELETE' }),
  downloadCohortFile: (cohortId: number, fileId: number, versionId?: number | null) =>
    fetchApi<components['schemas']['CohortFileDownloadResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/download${versionId ? `?version_id=${versionId}` : ''}`, { cache: 'no-store' }),
  getCohortFilePreview: (cohortId: number, fileId: number, versionId?: number | null) =>
    fetchApi<components['schemas']['CohortFilePreviewResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/preview${versionId ? `?version_id=${versionId}` : ''}`, { cache: 'no-store' }),
  getCohortFileVersions: (cohortId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortFileVersionsResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/versions`, { cache: 'no-store' }),
  createCohortFileVersion: (cohortId: number, fileId: number, data: components['schemas']['CohortFileVersionCreateInput']) =>
    fetchApi<components['schemas']['CohortFileVersionUploadResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/versions`, { method: 'POST', body: JSON.stringify(data) }),
  completeCohortFileVersion: (cohortId: number, fileId: number, versionId: number) =>
    fetchApi<components['schemas']['CohortFileVersionCompleteResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/versions/${versionId}/complete`, { method: 'POST' }),
  /** Learn Docs are saved ready in one step and work without file storage. */
  createCohortDoc: (cohortId: number, data: Omit<components['schemas']['CohortDocCreateInput'], 'kind'>) =>
    fetchApi<components['schemas']['CohortFileResponse']>(`/api/v1/cohorts/${cohortId}/files`, { method: 'POST', body: JSON.stringify({ ...data, kind: 'doc' }) }),
  getCohortDoc: (cohortId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortDocResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/doc`, { cache: 'no-store' }),
  /** 409 when `base_doc_version` is missing or stale; nothing is saved then. */
  saveCohortDoc: (cohortId: number, fileId: number, data: components['schemas']['CohortDocUpdateInput']) =>
    fetchApi<components['schemas']['CohortDocResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/doc`, { method: 'PATCH', body: JSON.stringify(data) }),
  getCohortDocRevisions: (cohortId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortDocRevisionsResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/revisions`, { cache: 'no-store' }),
  getCohortDocRevision: (cohortId: number, fileId: number, revisionId: number) =>
    fetchApi<components['schemas']['CohortDocRevisionResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/revisions/${revisionId}`, { cache: 'no-store' }),
  /** 409 when the doc moved past `baseDocVersion`; nothing is restored then. */
  restoreCohortDocRevision: (cohortId: number, fileId: number, revisionId: number, baseDocVersion: number) =>
    fetchApi<components['schemas']['CohortDocResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/revisions/${revisionId}/restore`, {
      method: 'POST', body: JSON.stringify({ base_doc_version: baseDocVersion } satisfies components['schemas']['CohortDocRestoreInput']),
    }),
  setCohortFileReview: (cohortId: number, fileId: number, reviewStatus: components['schemas']['CohortFileReviewInput']['review_status']) =>
    fetchApi<components['schemas']['CohortFileResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/review`, { method: 'PATCH', body: JSON.stringify({ review_status: reviewStatus }) }),
  getCohortFileComments: (cohortId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortFileCommentsResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/comments`, { cache: 'no-store' }),
  createCohortFileComment: (cohortId: number, fileId: number, body: string) =>
    fetchApi<components['schemas']['CohortFileCommentResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteCohortFileComment: (cohortId: number, fileId: number, commentId: number) =>
    fetchApi<null>(`/api/v1/cohorts/${cohortId}/files/${fileId}/comments/${commentId}`, { method: 'DELETE' }),
  renameCohortFolder: (cohortId: number, data: components['schemas']['CohortFolderRenameInput']) =>
    fetchApi<components['schemas']['CohortFolderRenameResponse']>(`/api/v1/cohorts/${cohortId}/files/rename_folder`, { method: 'PATCH', body: JSON.stringify(data) }),
  importCohortCurriculumFiles: (cohortId: number) =>
    fetchApi<components['schemas']['CohortFileImportResponse']>(`/api/v1/cohorts/${cohortId}/files/import_curriculum`, { method: 'POST' }, true, CURRICULUM_COPY_TIMEOUT_MS),
  copyCohortFilesFromCohort: (cohortId: number, sourceCohortId: number) =>
    fetchApi<components['schemas']['CohortFileCohortCopyResponse']>(`/api/v1/cohorts/${cohortId}/files/copy_from_cohort`, {
      method: 'POST', body: JSON.stringify({ source_cohort_id: sourceCohortId } satisfies components['schemas']['CohortFileCohortCopyInput']),
    }, true, CURRICULUM_COPY_TIMEOUT_MS),
  /** `scope` my_files (learners), class or student (staff, with `studentId`); `folder` narrows to one folder. */
  exportCohortFilesZip: (cohortId: number, options: { scope: 'my_files' | 'class' | 'student'; studentId?: number; folder?: string }) => {
    const query = new URLSearchParams({ scope: options.scope });
    if (options.studentId) query.set('student_id', String(options.studentId));
    if (options.folder) query.set('folder', options.folder);
    return fetchBlob(`/api/v1/cohorts/${cohortId}/files/export_zip?${query.toString()}`);
  },
  getCurriculumFiles: (curriculumId: number) =>
    fetchApi<components['schemas']['CurriculumFilesResponse']>(`/api/v1/curricula/${curriculumId}/files`, { cache: 'no-store' }),
  createCurriculumFileUpload: (curriculumId: number, data: components['schemas']['CurriculumFileUploadInput']) =>
    fetchApi<components['schemas']['CurriculumFileUploadResponse']>(`/api/v1/curricula/${curriculumId}/files`, { method: 'POST', body: JSON.stringify(data) }),
  completeCurriculumFile: (curriculumId: number, fileId: number) =>
    fetchApi<components['schemas']['CurriculumFileResponse']>(`/api/v1/curricula/${curriculumId}/files/${fileId}/complete`, { method: 'POST' }),
  createCurriculumLink: (curriculumId: number, data: components['schemas']['CurriculumLinkCreateInput']) =>
    fetchApi<components['schemas']['CurriculumFileResponse']>(`/api/v1/curricula/${curriculumId}/files/links`, { method: 'POST', body: JSON.stringify(data) }),
  createCurriculumDoc: (curriculumId: number, data: components['schemas']['CurriculumDocCreateInput']) =>
    fetchApi<components['schemas']['CurriculumFileResponse']>(`/api/v1/curricula/${curriculumId}/files/docs`, { method: 'POST', body: JSON.stringify(data) }),
  updateCurriculumFile: (curriculumId: number, fileId: number, data: components['schemas']['CurriculumFileUpdateInput']) =>
    fetchApi<components['schemas']['CurriculumFileResponse']>(`/api/v1/curricula/${curriculumId}/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCurriculumFile: (curriculumId: number, fileId: number, options: { pendingOnly?: boolean } = {}) =>
    fetchApi<null>(`/api/v1/curricula/${curriculumId}/files/${fileId}${options.pendingOnly ? '?pending_only=true' : ''}`, { method: 'DELETE' }),
  getCurriculumDoc: (curriculumId: number, fileId: number) =>
    fetchApi<components['schemas']['CurriculumDocResponse']>(`/api/v1/curricula/${curriculumId}/files/${fileId}/doc`, { cache: 'no-store' }),
  downloadCurriculumFile: (curriculumId: number, fileId: number) =>
    fetchApi<components['schemas']['CohortFileDownloadResponse']>(`/api/v1/curricula/${curriculumId}/files/${fileId}/download`, { cache: 'no-store' }),
  copyCohortFileToStudents: (cohortId: number, fileId: number, folder?: string) =>
    fetchApi<components['schemas']['CohortFileCopyResponse']>(`/api/v1/cohorts/${cohortId}/files/${fileId}/copy_to_students`, {
      method: 'POST', body: JSON.stringify(folder ? { folder } : {}),
    }),
  getAnnouncements: (params?: {
    scope?: 'manage';
    page?: number;
    per_page?: number;
    audience?: 'cohort' | 'global' | 'staff';
    /** Manage only. `draft` is unscheduled drafts; `scheduled` is drafts with a send time. */
    status?: 'draft' | 'scheduled' | 'published' | 'archived';
    cohort_id?: number | null;
    read?: 'read' | 'unread';
    sort?: 'published_desc' | 'published_asc' | 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc' | 'scheduled_asc';
  }) =>
    fetchApi<AnnouncementsResponse>(`/api/v1/announcements${(() => {
      if (!params) return '';
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        searchParams.set(key, String(value));
      });
      const query = searchParams.toString();
      return query ? `?${query}` : '';
    })()}`),
  getAnnouncement: (id: number) =>
    fetchApi<AnnouncementResponse>(`/api/v1/announcements/${id}`),
  createAnnouncement: (data: { title: string; body: string; audience: string; cohort_id?: number | null; status?: string; pinned?: boolean; send_push?: boolean; client_request_id?: string; scheduled_for?: string | null }) =>
    fetchApi<AnnouncementResponse>('/api/v1/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAnnouncement: (id: number, data: { title?: string; body?: string; audience?: string; cohort_id?: number | null; status?: string; pinned?: boolean; send_push?: boolean; scheduled_for?: string | null }) =>
    fetchApi<AnnouncementResponse>(`/api/v1/announcements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  /** Archives a posted update; deletes a draft (the response is its last state). */
  archiveAnnouncement: (id: number) =>
    fetchApi<AnnouncementResponse>(`/api/v1/announcements/${id}`, { method: 'DELETE' }),
  getNotifications: (params: { limit?: number; page?: number; per_page?: number; notification_type?: string; read?: 'read' | 'unread'; sort?: 'created_desc' | 'created_asc' | 'read_desc' | 'read_asc' } = {}) =>
    fetchApi<NotificationsResponse>(`/api/v1/notifications${(() => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        searchParams.set(key, String(value));
      });
      const query = searchParams.toString();
      return query ? `?${query}` : '';
    })()}`),
  markNotificationRead: (id: number) =>
    fetchApi<NotificationResponse>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: (notificationType?: string) =>
    fetchApi<MarkAllNotificationsReadResponse>(`/api/v1/notifications/mark_all_read${notificationType ? `?notification_type=${notificationType}` : ''}`, { method: 'PATCH' }),
  getPushConfig: () =>
    fetchApi<PushConfigResponse>('/api/v1/push_subscriptions/config'),
  updateMessageNotifications: (notificationsEnabled: boolean) =>
    fetchApi<MessageNotificationPreferenceResponse>('/api/v1/push_subscriptions/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ notifications_enabled: notificationsEnabled }),
    }),
  updateWebPushNotifications: (notificationsEnabled: boolean) =>
    fetchApi<WebPushNotificationPreferenceResponse>('/api/v1/push_subscriptions/web_preferences', {
      method: 'PATCH',
      body: JSON.stringify({ notifications_enabled: notificationsEnabled }),
    }),
  createPushSubscription: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    fetchApi<PushSubscriptionResponse>('/api/v1/push_subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  deletePushSubscription: (endpoint?: string, all = false) =>
    fetchApi<null>('/api/v1/push_subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint, all }),
    }),
  createCableToken: () =>
    fetchApi<CableTokenResponse>('/api/v1/cable_token', { method: 'POST' }),
  getWorkspaces: () =>
    fetchApi<WorkspacesResponse>('/api/v1/workspaces'),
  getWorkspace: (id: number) =>
    fetchApi<WorkspaceResponse>(`/api/v1/workspaces/${id}`),
  createWorkspace: (data: { name: string; description?: string; user_ids?: number[] }) =>
    fetchApi<WorkspaceResponse>('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateWorkspace: (id: number, data: { name?: string; description?: string; status?: 'active' | 'archived' }) =>
    fetchApi<WorkspaceResponse>(`/api/v1/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  addWorkspaceMembers: (workspaceId: number, user_ids: number[]) =>
    fetchApi<WorkspaceResponse>(`/api/v1/workspaces/${workspaceId}/memberships`, {
      method: 'POST',
      body: JSON.stringify({ user_ids }),
    }),
  removeWorkspaceMember: (workspaceId: number, userId: number) =>
    fetchApi<WorkspaceResponse>(`/api/v1/workspaces/${workspaceId}/memberships/${userId}`, {
      method: 'DELETE',
    }),
  getChannels: () =>
    fetchUnreadList<ChannelsResponse>('/api/v1/channels'),
  getChannel: (id: number, params?: { message_limit?: number; around_message_id?: number; before_message_id?: number; after_message_id?: number }) =>
    fetchApi<ChannelResponse>(`/api/v1/channels/${id}${queryString(params)}`),
  createChannel: (data: { workspace_id?: number; cohort_id?: number; name: string; description?: string; visibility?: string }) =>
    fetchApi<ChannelResponse>('/api/v1/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  markChannelRead: (id: number, messageId?: number) =>
    fetchApi<ChannelResponse>(`/api/v1/channels/${id}/read`, {
      method: 'PATCH',
      ...(messageId === undefined ? {} : { body: JSON.stringify({ message_id: messageId }) }),
    }),
  createMessage: (channelId: number, data: { body: string; parent_message_id?: number | null; client_message_id?: string; mention_user_ids?: number[]; attachments?: { s3_key: string; filename: string; content_type: string; byte_size: number }[]; send_push?: boolean }) =>
    fetchApi<MessageResponse>(`/api/v1/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDirectConversations: (params?: { cohort_id?: number; student_id?: number }) =>
    fetchUnreadList<DirectConversationsResponse>(`/api/v1/direct_conversations${queryString(params || {})}`),
  getAvailableDirectUsersForCohort: (cohortId: number) =>
    fetchApi<AvailableDirectUsersResponse>(`/api/v1/direct_conversations/available_users?cohort_id=${cohortId}`),
  getAvailableDirectUsers: (workspaceId: number) =>
    fetchApi<AvailableDirectUsersResponse>(`/api/v1/direct_conversations/available_users?workspace_id=${workspaceId}`),
  getDirectConversation: (id: number, params?: { message_limit?: number; around_message_id?: number; before_message_id?: number; after_message_id?: number }) =>
    fetchApi<DirectConversationResponse>(`/api/v1/direct_conversations/${id}${queryString(params)}`),
  createDirectConversation: (data: { workspace_id?: number; cohort_id?: number; user_ids: number[] }) =>
    fetchApi<DirectConversationResponse>('/api/v1/direct_conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  markDirectConversationRead: (id: number, messageId?: number) =>
    fetchApi<DirectConversationResponse>(`/api/v1/direct_conversations/${id}/read`, {
      method: 'PATCH',
      ...(messageId === undefined ? {} : { body: JSON.stringify({ message_id: messageId }) }),
    }),
  createDirectMessage: (conversationId: number, data: { body: string; parent_message_id?: number | null; client_message_id?: string; mention_user_ids?: number[]; attachments?: { s3_key: string; filename: string; content_type: string; byte_size: number }[]; send_push?: boolean; source_type?: MessageSourceType; source_id?: number }) =>
    fetchApi<MessageResponse>(`/api/v1/direct_conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getMessageDestination: (id: number) => fetchApi<MessageDestination>(`/api/v1/messages/${id}/destination`),
  getMessageThread: (id: number, options: ThreadWindowOptions = {}) =>
    fetchApi<components['schemas']['ThreadResponse']>(`/api/v1/messages/${id}/thread?${new URLSearchParams(Object.entries({ window: 1, ...options }).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]))}`),
  updateMessage: (id: number, data: { body: string; mention_user_ids?: number[] }) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteMessage: (id: number) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}`, { method: 'DELETE' }),
  pinMessage: (id: number) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}/pin`, { method: 'PATCH' }),
  unpinMessage: (id: number) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}/pin`, { method: 'DELETE' }),
  reactMessage: (id: number, emoji: string) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  unreactMessage: (id: number, emoji: string) =>
    fetchApi<MessageResponse>(`/api/v1/messages/${id}/reactions`, {
      method: 'DELETE',
      body: JSON.stringify({ emoji }),
    }),
  updateEditorPreferences: (preferences: EditorPreferencesInput) =>
    fetchApi<EditorPreferencesResponse>('/api/v1/editor_preferences', { method: 'PATCH', body: JSON.stringify(preferences) }),
  updateMessagePreference: (targetType: 'Channel' | 'DirectConversation', targetId: number, muted: boolean) =>
    fetchApi<MessagePreferenceResponse>('/api/v1/message_preferences', {
      method: 'PATCH',
      body: JSON.stringify({ target_type: targetType, target_id: targetId, muted }),
    }),
  presignMessageAttachment: (data: { channel_id?: number; direct_conversation_id?: number; filename: string; content_type: string }) =>
    fetchApi<MessageAttachmentPresignResponse>('/api/v1/message_attachments/presign', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  searchEverything: (q: string) => fetchApi<import('../types/api.generated').components['schemas']['SearchResponse']>(`/api/v1/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }),

  searchMessages: (q: string, limit = 30) =>
    fetchApi<MessageSearchResponse>(`/api/v1/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** A peek card's summary (L-0.5). Not kept in the offline response cache: peek cards keep their own short cache. */
  getRecordSummary: (type: 'student' | 'lesson' | 'cohort', id: number, cohortId?: number | null, signal?: AbortSignal) =>
    fetchApi<{ summary: import('./recordSummary').RecordSummary }>(
      `/api/v1/records/${type}/${id}/summary${cohortId ? `?cohort_id=${cohortId}` : ''}`,
      { cache: 'no-store', signal },
    ),
  /** A record page's related panel and breadcrumb names (L-0.4), in one request. Not cached offline: counts are per viewer. */
  getRecordRelated: (type: import('./recordRelated').RelatedRecordType, id: number, params: { cohortId?: number | null; studentId?: number | null } = {}, signal?: AbortSignal) =>
    fetchApi<{ related: import('./recordRelated').RecordRelated }>(
      `/api/v1/records/${type}/${id}/related${queryString({ cohort_id: params.cohortId, student_id: params.studentId })}`,
      { cache: 'no-store', signal },
    ),
  /** Where a curriculum, module or lesson is used (staff, L-3.2 / L-5). Not cached offline: per viewer. */
  getRecordUsage: (type: 'curriculum' | 'module' | 'lesson', id: number, signal?: AbortSignal) =>
    fetchApi<components['schemas']['RecordUsageResponse']>(`/api/v1/records/${type}/${id}/usage`, { cache: 'no-store', signal }),
  /**
   * `watchersAfter` continues a recording's watchers (the previous response's `watchers_next_after`);
   * `purchasesBefore` continues an offering's purchases (`purchases_next_before`).
   */
  getRecordDetail: (type: 'recording' | 'office_hour' | 'private_meeting' | 'learning_plan' | 'channel' | 'rubric' | 'activity_event' | 'recovery_plan' | 'content_report' | 'offering', id: number, options: { watchersAfter?: number; purchasesBefore?: number; signal?: AbortSignal } = {}) => {
    const query = new URLSearchParams()
    if (options.watchersAfter) query.set('watchers_after', String(options.watchersAfter))
    if (options.purchasesBefore) query.set('purchases_before', String(options.purchasesBefore))
    const search = query.toString()
    return fetchApi<components['schemas']['RecordDetailResponse']>(`/api/v1/records/${type}/${id}/detail${search ? `?${search}` : ''}`, { cache: 'no-store', signal: options.signal })
  },
  acceptCommunityPolicy: (version: string) =>
    fetchApi<components['schemas']['CommunityPolicyResponse']>('/api/v1/community_policy/accept', {
      method: 'POST', body: JSON.stringify({ version, accepted: true }),
    }),
  reportContent: (data: { message_id?: number; reported_user_id?: number; reason: string; details?: string }) =>
    fetchApi<components['schemas']['ContentReportResponse']>('/api/v1/content_reports', {
      method: 'POST', body: JSON.stringify({ content_report: data }),
    }),
  /** `open`: the queue, oldest first. `resolved`: history, most recently resolved first, paginated. `user_id`: by or about one person. */
  getContentReports: (params: { view?: 'open' | 'resolved'; page?: number; per_page?: number; status?: string; user_id?: number } = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString()
    return fetchApi<components['schemas']['ContentReportsResponse']>(`/api/v1/content_reports${query ? `?${query}` : ''}`)
  },
  getContentReport: (id: number) => fetchApi<components['schemas']['ContentReportResponse']>(`/api/v1/content_reports/${id}`),
  /** Every block between two people (admins, read-only). `user_id`: blocks one person made or received. */
  getSafetyUserBlocks: (params: { page?: number; per_page?: number; user_id?: number } = {}) =>
    fetchApi<components['schemas']['SafetyUserBlocksResponse']>(`/api/v1/safety/user_blocks?page=${params.page ?? 1}&per_page=${params.per_page ?? 25}${params.user_id ? `&user_id=${params.user_id}` : ''}`),
  /** One staff person's record (admins). */
  getTeamMember: (id: number) => fetchApi<components['schemas']['TeamMemberResponse']>(`/api/v1/team_members/${id}`),
  updateContentReport: (id: number, status: 'reviewing' | 'actioned' | 'dismissed', resolutionNote?: string) =>
    fetchApi<components['schemas']['ContentReportResponse']>(`/api/v1/content_reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content_report: {
          status,
          ...(resolutionNote !== undefined ? { resolution_note: resolutionNote } : {}),
        },
      }),
    }),
  blockUser: (blockedUserId: number) =>
    fetchApi<components['schemas']['BlockedUserResponse']>('/api/v1/user_blocks', {
      method: 'POST', body: JSON.stringify({ blocked_user_id: blockedUserId }),
    }),
  getBlockedUsers: () => fetchApi<components['schemas']['BlockedUsersResponse']>('/api/v1/user_blocks'),
  unblockUser: (blockedUserId: number) => fetchApi<void>(`/api/v1/user_blocks/${blockedUserId}`, { method: 'DELETE' }),
  getAgentPostingTokens: () =>
    fetchApi<components['schemas']['AgentPostingTokensResponse']>('/api/v1/agent_posting_tokens', { cache: 'no-store' }),
  createAgentPostingToken: (data: { name: string; expires_in_days: number | null }) =>
    fetchApi<components['schemas']['AgentPostingTokenCreatedResponse']>('/api/v1/agent_posting_tokens', {
      method: 'POST', body: JSON.stringify(data),
    }),
  revokeAgentPostingToken: (id: number) =>
    fetchApi<components['schemas']['AgentPostingTokenResponse']>(`/api/v1/agent_posting_tokens/${id}/revoke`, { method: 'PATCH' }),
  requestDataDeletion: () => fetchApi<components['schemas']['DataDeletionRequestResponse']>('/api/v1/data_deletion_requests', { method: 'POST' }),
  getDataDeletionRequests: () => fetchApi<components['schemas']['DataDeletionRequestsResponse']>('/api/v1/data_deletion_requests'),
  /** One deletion request (admins), for a Safety link to one that isn't in the list being shown. */
  getDataDeletionRequest: (id: number) => fetchApi<components['schemas']['DataDeletionRequestResponse']>(`/api/v1/data_deletion_requests/${id}`),
  updateDataDeletionRequest: (id: number, data: { status: 'processing' | 'completed' | 'declined'; retention_note?: string }) =>
    fetchApi<components['schemas']['DataDeletionRequestResponse']>(`/api/v1/data_deletion_requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ data_deletion_request: data }),
    }),

  // Profile
  getProfile: () =>
    fetchApi<ProfileResponse>('/api/v1/profile'),
  updateProfile: (data: { github_username?: string; avatar_url?: string; handle?: string }) =>
    fetchApi<ProfileUpdateResponse>('/api/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Modules
  getModule: (id: number, cohortId?: number) =>
    fetchApi<ModuleResponse>(`/api/v1/modules/${id}${queryString({ cohort_id: cohortId })}`),

  // Lessons
  getLesson: (id: number, cohortId?: number) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}${queryString({ cohort_id: cohortId })}`),

  getHelpRequests: (params: { cohort_id?: number; student_id?: number; status?: string; context_type?: HelpContextType } = {}) =>
    fetchApi<HelpRequestsResponse>(`/api/v1/help_requests${queryString(params)}`),
  getHelpRequest: (id: number) => fetchApi<HelpRequestResponse>(`/api/v1/help_requests/${id}`),
  createHelpRequest: (data: { cohort_id: number; context_type: HelpContextType; context_source?: HelpContextSource; context_id: number; category: HelpCategory; urgency: HelpUrgency; message: string }) =>
    fetchApi<HelpRequestResponse>('/api/v1/help_requests', {
      method: 'POST',
      body: JSON.stringify({ help_request: data }),
    }),
  updateHelpRequest: (id: number, data: { status: 'acknowledged' | 'resolved' | 'canceled'; staff_response?: string }) =>
    fetchApi<HelpRequestResponse>(`/api/v1/help_requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ help_request: data }),
    }),
  /** Reply (U-4.7): `resolve: false` keeps the request open, `true` is Reply & resolve. */
  /** `client_request_id`: one per reply attempt, reused on retry, so a resend never answers twice. */
  replyToHelpRequest: (id: number, data: { body: string; resolve: boolean; client_request_id?: string }) =>
    fetchApi<HelpRequestReplyResponse>(`/api/v1/help_requests/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ reply: data }),
    }),
  /** `lessonId` / `moduleId` narrow the help lists to that lesson or module (L-3.2). */
  getSupportQueue: (cohortId?: number, signal?: AbortSignal, help: { lessonId?: number | null; moduleId?: number | null; studentId?: number | null } = {}) =>
    fetchApi<SupportQueueResponse>(`/api/v1/support_queue${queryString({ cohort_id: cohortId, lesson_id: help.lessonId, module_id: help.moduleId, student_id: help.studentId })}`, signal ? { signal } : {}),
  getInterventions: (params: { enrollment_id?: number; owner_id?: number; status?: InterventionStatus; due?: boolean } = {}) =>
    fetchApi<InterventionsResponse>(`/api/v1/interventions${queryString(params)}`),
  getIntervention: (id: number) => fetchApi<InterventionResponse>(`/api/v1/interventions/${id}`),
  createIntervention: (data: { enrollment_id: number; help_request_id?: number; trigger_type: InterventionTrigger; severity?: InterventionSeverity; owner_id?: number; action_summary?: string; next_follow_up_at?: string }) =>
    fetchApi<InterventionResponse>('/api/v1/interventions', { method: 'POST', body: JSON.stringify({ intervention: data }) }),
  updateIntervention: (id: number, data: { status?: InterventionStatus; severity?: InterventionSeverity; owner_id?: number; action_summary?: string; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) =>
    fetchApi<InterventionResponse>(`/api/v1/interventions/${id}`, { method: 'PATCH', body: JSON.stringify({ intervention: data }) }),
  createInterventionNote: (id: number, body: string) =>
    fetchApi<{ note: import('../types/api').InterventionNote }>(`/api/v1/interventions/${id}/notes`, { method: 'POST', body: JSON.stringify({ note: { body } }) }),
  getRecoveryPlans: (params: { enrollment_id?: number; status?: string; due?: boolean } = {}) =>
    fetchApi<RecoveryPlansResponse>(`/api/v1/recovery_plans${queryString(params)}`),
  getRecoveryPlan: (id: number) => fetchApi<RecoveryPlanResponse>(`/api/v1/recovery_plans/${id}`),
  createRecoveryPlan: (data: { enrollment_id: number; intervention_id?: number; source: 'extended_absence' | 'manual'; owner_id?: number; target_pace: string; required_scope: string; optional_scope?: string; check_in_cadence?: string; next_check_in_at?: string }) =>
    fetchApi<RecoveryPlanResponse>('/api/v1/recovery_plans', { method: 'POST', body: JSON.stringify({ recovery_plan: data }) }),
  updateRecoveryPlan: (id: number, data: { status?: 'active' | 'completed' | 'canceled'; target_pace?: string; required_scope?: string; optional_scope?: string; check_in_cadence?: string; next_check_in_at?: string; outcome?: string }) =>
    fetchApi<RecoveryPlanResponse>(`/api/v1/recovery_plans/${id}`, { method: 'PATCH', body: JSON.stringify({ recovery_plan: data }) }),
  createRecoveryPlanCheckIn: (id: number, data: { body: string; next_check_in_at?: string }) =>
    fetchApi<{ recovery_plan: import('../types/api').RecoveryPlan }>(`/api/v1/recovery_plans/${id}/check_ins`, { method: 'POST', body: JSON.stringify({ check_in: data }) }),

  getLearningPlan: (enrollmentId: number) =>
    fetchApi<import('../types/api').LearningPlanManagement>(`/api/v1/enrollments/${enrollmentId}/learning_plan`, { cache: 'no-store' }),
  saveLearningPlan: (enrollmentId: number, data: import('../types/api').LearningPlanInput) =>
    fetchApi<import('../types/api').LearningPlanManagement>(`/api/v1/enrollments/${enrollmentId}/learning_plan`, { method: 'PUT', body: JSON.stringify({ learning_plan: data }) }),
  getLearnerExtensions: (enrollmentId: number) =>
    fetchApi<{ personal_pace: boolean; extensions: import('../types/api').LearnerExtension[] }>(`/api/v1/enrollments/${enrollmentId}/extensions`, { cache: 'no-store' }),
  saveLearnerExtension: (enrollmentId: number, data: import('../types/api').LearnerExtensionInput | components['schemas']['LearnerExtensionUpdateInput'], id?: number) =>
    fetchApi<{ personal_pace: boolean; extensions: import('../types/api').LearnerExtension[] }>(`/api/v1/enrollments/${enrollmentId}/extensions${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }),
  getLearnerNudges: (enrollmentId: number) =>
    fetchApi<components['schemas']['LearnerNudgesResponse']>(`/api/v1/enrollments/${enrollmentId}/nudges`, { cache: 'no-store' }),
  getNudgePreference: () =>
    fetchApi<components['schemas']['NudgePreferenceResponse']>('/api/v1/nudge_preferences', { cache: 'no-store' }),
  updateNudgePreference: (enabled: boolean) =>
    fetchApi<components['schemas']['NudgePreferenceResponse']>('/api/v1/nudge_preferences', { method: 'PATCH', body: JSON.stringify({ learner_nudges_enabled: enabled }) }),
  removeLearnerExtension: (enrollmentId: number, id: number, reason: string) =>
    fetchApi<{ personal_pace: boolean; extensions: import('../types/api').LearnerExtension[] }>(`/api/v1/enrollments/${enrollmentId}/extensions/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  getPersonalPace: (enrollmentId: number) =>
    fetchApi<import('../types/api').PersonalPaceResponse>(`/api/v1/enrollments/${enrollmentId}/pace`, { cache: 'no-store' }),
  savePersonalPace: (enrollmentId: number, data: import('../types/api').PersonalPaceUpdateRequest) =>
    fetchApi<import('../types/api').PersonalPaceResponse>(`/api/v1/enrollments/${enrollmentId}/pace`, { method: 'PUT', body: JSON.stringify(data) }),

  // Progress
  updateProgress: (contentBlockId: number, status: string, cohortId?: number, videoSource?: string) =>
    fetchApi<ProgressUpdateResponse>('/api/v1/progress', {
      method: 'PATCH',
      body: JSON.stringify({ content_block_id: contentBlockId, status, cohort_id: cohortId, video_source: videoSource }),
    }),

  // Submissions
  getSubmissions: (params?: Record<string, string>, signal?: AbortSignal) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<SubmissionsListResponse>(`/api/v1/submissions${query}`, signal ? { signal } : {});
  },
  /** One page of the Grading workbench's queue, filtered and counted on the server. */
  getGradingQueue: (params: GradingQueueParams, signal?: AbortSignal) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    return fetchApi<GradingQueueResponse>(`/api/v1/grading_queue${query ? `?${query}` : ''}`, signal ? { signal } : {});
  },
  getSubmission: (id: number) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}`),
  /** One exercise's ungraded work with answer text, for Batch review (never cached). */
  getBatchReview: (params: { cohort_id?: number | null; module_id?: number | null; lesson_id?: number | null; content_block_id?: number | null }) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    return fetchApi<components['schemas']['BatchReviewResponse']>(`/api/v1/submissions/batch_review${query ? `?${query}` : ''}`, { cache: 'no-store' });
  },
  batchGradeSubmissions: (data: components['schemas']['BatchGradeInput']) =>
    fetchApi<components['schemas']['BatchGradeResponse']>('/api/v1/submissions/batch_grade', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  prepareGithubIdentity: (enrollmentId: number) =>
    fetchApi<components['schemas']['GithubIdentityPrepareResponse']>(`/api/v1/enrollments/${enrollmentId}/github_identity/prepare`, { method: 'POST' }),
  completeGithubIdentity: (data: { state: string; code: string }) =>
    fetchApi<components['schemas']['GithubIdentityConnectResponse']>('/api/v1/github_identity/callback', { method: 'POST', body: JSON.stringify(data) }),
  getGithubAppInstallations: (cohortId: number) =>
    fetchApi<components['schemas']['GithubAppInstallationsResponse']>(`/api/v1/cohorts/${cohortId}/github_app_installations`, { cache: 'no-store' }),
  prepareGithubAppInstallation: (cohortId: number) =>
    fetchApi<components['schemas']['GithubAppPrepareResponse']>(`/api/v1/cohorts/${cohortId}/github_app_installations/prepare`, { method: 'POST' }),
  connectGithubAppInstallation: (cohortId: number, data: { state: string; installation_id: number }) =>
    fetchApi<components['schemas']['GithubAppConnectionResponse']>(`/api/v1/cohorts/${cohortId}/github_app_installations`, { method: 'POST', body: JSON.stringify(data) }),
  completeGithubAppSetup: (data: { state: string; installation_id: number }) =>
    fetchApi<components['schemas']['GithubAppConnectionResponse']>('/api/v1/github_app/setup', { method: 'POST', body: JSON.stringify(data) }),
  getGithubRepositoryBindings: (enrollmentId: number) =>
    fetchApi<components['schemas']['GithubRepositoryBindingsResponse']>(`/api/v1/enrollments/${enrollmentId}/github_repository_bindings`, { cache: 'no-store' }),
  saveGithubRepositoryBinding: (enrollmentId: number, data: { full_name: string; github_app_installation_id: number; curriculum_module_id: number | null }) =>
    fetchApi<components['schemas']['GithubRepositoryBindingResponse']>(`/api/v1/enrollments/${enrollmentId}/github_repository_bindings`, { method: 'POST', body: JSON.stringify(data) }),
  verifyGithubRepositoryBinding: (enrollmentId: number, id: number) =>
    fetchApi<components['schemas']['GithubRepositoryBindingResponse']>(`/api/v1/enrollments/${enrollmentId}/github_repository_bindings/${id}/verify`, { method: 'POST' }),
  getSubmissionGithubChecks: (id: number) =>
    fetchApi<GithubChecksResponse>(`/api/v1/submissions/${id}/github_checks`),
  refreshSubmissionGithubChecks: (id: number) =>
    fetchApi<GithubChecksResponse>(`/api/v1/submissions/${id}/github_checks`, { method: 'POST' }),
  createSubmission: (data: { content_block_id: number; cohort_id?: number; text?: string; github_issue_url?: string; github_code_url?: string; repo_url?: string; pr_url?: string; live_url?: string; branch?: string; commit_sha?: string; notes?: string }) =>
    fetchApi<SubmissionResponse>('/api/v1/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSubmission: (id: number, data: { cohort_id?: number; text?: string; repo_url?: string; pr_url?: string; live_url?: string; branch?: string; commit_sha?: string; notes?: string }) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  gradeSubmission: (
    id: number,
    data: {
      grade: string;
      base_submission_updated_at: string;
      feedback?: string;
      criterion_results?: { rubric_criterion_id: number; rating: import('../types/api').RubricRating; feedback?: string }[];
      suggestion_decision?: 'accepted' | 'overridden' | 'dismissed';
      suggestion_override_reason?: string;
    },
  ) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}/grade`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  evaluateSubmissionGradeSuggestion: (id: number) =>
    fetchApi<components['schemas']['EvaluateGradeSuggestionResponse']>(
      `/api/v1/submissions/${id}/evaluate_grade_suggestion`,
      { method: 'POST' },
    ),
  getFeedbackSnippets: () =>
    fetchApi<{ feedback_snippets: import('../types/api').FeedbackSnippet[] }>('/api/v1/feedback_snippets'),
  createFeedbackSnippet: (body: string) =>
    fetchApi<{ feedback_snippet: import('../types/api').FeedbackSnippet }>('/api/v1/feedback_snippets', {
      method: 'POST',
      body: JSON.stringify({ feedback_snippet: { body } }),
    }),
  useFeedbackSnippet: (id: number) =>
    fetchApi<{ feedback_snippet: import('../types/api').FeedbackSnippet }>(`/api/v1/feedback_snippets/${id}/use`, { method: 'POST' }),
  attemptKnowledgeCheck: (id: number, selectedOption: number, cohortId?: number) =>
    fetchApi<{ knowledge_check: import('../types/api').KnowledgeCheck; progress: { status: string; completed_at: string | null } | null }>(`/api/v1/knowledge_checks/${id}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ selected_option: selectedOption, cohort_id: cohortId }),
    }),
  getSubmissionGithubIssue: (id: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/submissions/${id}/github_issue`),
  retrySubmissionGithubIssue: (id: number) =>
    fetchApi<components['schemas']['RetryGithubIssueResponse']>(`/api/v1/submissions/${id}/retry_github_issue`, {
      method: 'POST',
    }),

  // Student progress (admin)
  getActivityEvents: (params?: { feed?: 'cohort' | 'school'; actor_id?: number; since?: string; until?: string; user_id?: number; cohort_id?: number; category?: string; before_id?: number; limit?: number }) =>
    fetchApi<ActivityEventsResponse>(`/api/v1/activity_events${queryString(params || {})}`),
  getStudentProgress: (userId: number, cohortId?: number) =>
    fetchApi<StudentProgressResponse>(`/api/v1/progress/student/${userId}${queryString({ cohort_id: cohortId })}`),
  getStudentCommunication: (userId: number, cohortId: number) =>
    fetchApi<{ communication: import('../types/api').StudentCommunication }>(`/api/v1/progress/student/${userId}/communication${queryString({ cohort_id: cohortId })}`),
  getLearningInsights: (cohortId: number, userId?: number) =>
    fetchApi<LearningInsightsResponse>(`/api/v1/cohorts/${cohortId}/learning_insights${queryString({ user_id: userId })}`),
  getCohortReleaseCommunications: (cohortId: number) =>
    fetchApi<import('../types/api').CohortReleaseCommunicationsResponse>(
      `/api/v1/cohorts/${cohortId}/release_communications`,
      { cache: 'no-store' },
    ),
  restartEnrollment: (enrollmentId: number, confirmation: string, reason: string, restartVersion: string | null | undefined) =>
    fetchApi<{
      message: string;
      restart: {
        id: number;
        student_id: number;
        cohort_id: number;
        records_removed: Record<string, number>;
        created_at: string;
      };
      recovery_plan: import('../types/api').RecoveryPlan;
    }>(`/api/v1/enrollments/${enrollmentId}/restart`, {
      method: 'POST',
      body: JSON.stringify({ confirmation, reason, restart_version: restartVersion }),
    }),

  // Admin — Users
  getUsers: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<UsersListResponse>(`/api/v1/users${query}`);
  },
  createUser: (data: { email: string; role?: string; github_username?: string; skip_invite?: boolean }) =>
    fetchApi<UserUpdateResponse>('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resendInvite: (userId: number) =>
    fetchApi<{ message: string; invitation: { status: string; sent_at: string | null; error: string | null } }>(`/api/v1/users/${userId}/resend_invite`, {
      method: 'POST',
    }),
  getUser: (id: number) =>
    fetchApi<UserDetailResponse>(`/api/v1/users/${id}`),
  updateUser: (id: number, data: { first_name?: string; last_name?: string; role?: string; github_username?: string; avatar_url?: string }) =>
    fetchApi<UserUpdateResponse>(`/api/v1/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteUser: (id: number) =>
    fetchApi<{ message: string; action: 'archived' | 'deleted' }>(`/api/v1/users/${id}`, { method: 'DELETE' }),
  unarchiveUser: (id: number) =>
    fetchApi<UserUpdateResponse & { message: string; invitation?: { status: string; sent_at: string | null; error: string | null } }>(`/api/v1/users/${id}/unarchive`, { method: 'PATCH' }),

  // Admin — Curricula
  getCurricula: () =>
    fetchApi<CurriculaListResponse>('/api/v1/curricula'),
  getCurriculum: (id: number, signal?: AbortSignal) =>
    fetchApi<CurriculumResponse>(`/api/v1/curricula/${id}`, { signal }),
  previewCoursePackage: (packageData: unknown) =>
    fetchApi<components['schemas']['CoursePackagePreviewResponse']>('/api/v1/course_packages/preview', { method: 'POST', body: coursePackageBody(packageData) }),
  importCoursePackage: (packageData: unknown) =>
    fetchApi<{ import: { curriculum_id: number; unchanged: boolean } }>('/api/v1/course_packages', { method: 'POST', body: coursePackageBody(packageData) }),

  cloneAuthoring: (kind: 'curricula' | 'modules' | 'cohorts', id: number, data: { name: string; client_request_id: string; curriculum_id?: number; position?: number; start_date?: string; clone_curriculum?: boolean }) =>
    fetchApi<components['schemas']['AuthoringCloneResult']>(`/api/v1/${kind}/${id}/clone`, { method: 'POST', body: JSON.stringify(data) }),

  createCurriculum: (data: { name: string; description?: string; total_weeks?: number; status?: string; grading_scale?: GradingScale }) =>
    fetchApi<components['schemas']['CurriculumResponseMutation']>('/api/v1/curricula', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Admin — Cohorts
  getCohorts: () =>
    fetchApi<CohortsListResponse>('/api/v1/cohorts'),
  getAccessibleCohorts: () =>
    fetchApi<AccessibleCohortsResponse>('/api/v1/cohorts/accessible'),
  getCohort: (id: number, signal?: AbortSignal) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${id}`, signal ? { signal } : {}),
  getCohortHome: (id: number) =>
    fetchApi<CohortHomeResponse>(`/api/v1/cohorts/${id}/home`),
  getCohortInstructorAssignments: (id: number) =>
    fetchApi<CohortInstructorAssignmentsResponse>(`/api/v1/cohorts/${id}/instructor_assignments`),
  createCohortInstructorAssignment: (id: number, instructorId: number) =>
    fetchApi<{ instructor: import('../types/api').CohortInstructorAssignment }>(`/api/v1/cohorts/${id}/instructor_assignments`, {
      method: 'POST', body: JSON.stringify({ user_id: instructorId }),
    }),
  setCohortInstructorLessonEditing: (id: number, instructorId: number, canEditLessons: boolean) =>
    fetchApi<import('../types/api').CohortInstructorAssignmentResponse>(`/api/v1/cohorts/${id}/instructor_assignments/${instructorId}/lesson_editing`, {
      method: 'PATCH',
      body: JSON.stringify({ can_edit_lessons: canEditLessons }),
    }),
  deleteCohortInstructorAssignment: (id: number, instructorId: number) =>
    fetchApi<null>(`/api/v1/cohorts/${id}/instructor_assignments/${instructorId}`, { method: 'DELETE' }),
  getCohortGithubAccess: (id: number) =>
    fetchApi<import('../types/api').GithubAccessResponse>(`/api/v1/cohorts/${id}/github_access`, {}, true, 30_000),
  getCohortGithubSyncHealth: (id: number) =>
    fetchApi<CohortGithubSyncHealthResponse>(`/api/v1/cohorts/${id}/github_sync_health`, { cache: 'no-store' }),
  getCohortStudentView: (id: number) =>
    fetchApi<CohortStudentViewResponse>(`/api/v1/cohorts/${id}/student_view`),
  createCohort: (data: { name: string; cohort_type: string; curriculum_id: number; start_date: string; end_date?: string; status?: string;
    course_delivery?: 'program' | 'guided' | 'self_paced'
    public_checkout_enabled?: boolean
    unlisted?: boolean
    seat_limit?: number | null
    guided_access_ends_on?: string | null
    guided_support_ends_on?: string | null
    guided_access_months?: number | null
    guided_support_weeks?: number | null
    review_sla_business_days?: number | null
    review_response_time?: string
  }) =>
    fetchApi<CohortResponse>('/api/v1/cohorts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCohort: (id: number, data: { curriculum_id?: number; public_outcomes?: string; public_duration?: string; public_prerequisites?: string; public_preview?: string; public_title?: string; public_description?: string; public_image_url?: string;
    settings?: { next_step: components['schemas']['CourseCompletionNextStep'] | null }
    name?: string
    start_date?: string
    end_date?: string
    status?: string
    github_organization_name?: string | null
    course_delivery?: 'program' | 'guided' | 'self_paced'
    public_checkout_enabled?: boolean
    unlisted?: boolean
    seat_limit?: number | null
    public_price_cents?: number | null
    stripe_price_id?: string | null
    support_instructor_id?: number | null
    self_paced_access_months?: number
    self_paced_support_weeks?: number
    guided_access_ends_on?: string | null
    guided_support_ends_on?: string | null
    guided_access_months?: number | null
    guided_support_weeks?: number | null
    review_sla_business_days?: number | null
    learner_pace_weeks?: number[] | null
  }) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCohort: (id: number) =>
    fetchApi<null>(`/api/v1/cohorts/${id}`, { method: 'DELETE' }),
  updateCohortModuleAccess: (cohortId: number, data: { module_id: number; assigned?: boolean; unlocked?: boolean; module_start_date?: string | null; unlock_date_override?: string | null; requires_github?: boolean; repository_name?: string }) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/module_access`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateCohortClassResources: (cohortId: number, classResources: { title: string; url: string; category?: string; description?: string }[]) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/class_resources`, {
      method: 'PATCH',
      body: JSON.stringify({ class_resources: classResources }),
    }),
  updateCohortModuleSubmissionWindows: (cohortId: number, moduleId: number, submissionWindows: { week_number: number; submissions_close_at: string | null }[]) =>
    fetchApi<SubmissionWindowsResponse>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/submission_windows`, {
      method: 'PATCH',
      body: JSON.stringify({ submission_windows: submissionWindows }),
    }),
  getOfficeHours: (cohortId: number) =>
    fetchApi<OfficeHoursResponse>(`/api/v1/cohorts/${cohortId}/office_hours`),
  createOfficeHour: (cohortId: number, data: { title: string; description?: string | null; starts_at: string; ends_at: string; meeting_url: string; timezone?: string; recurrence?: 'once' | 'weekly'; event_kind?: 'office_hours' | 'live_class'; active?: boolean }) =>
    fetchApi<OfficeHourResponse>(`/api/v1/cohorts/${cohortId}/office_hours`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateOfficeHour: (cohortId: number, officeHourId: number, data: { title?: string; description?: string | null; starts_at?: string; ends_at?: string; meeting_url?: string; timezone?: string; recurrence?: 'once' | 'weekly'; event_kind?: 'office_hours' | 'live_class'; active?: boolean }) =>
    fetchApi<OfficeHourResponse>(`/api/v1/cohorts/${cohortId}/office_hours/${officeHourId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteOfficeHour: (cohortId: number, officeHourId: number) =>
    fetchApi<null>(`/api/v1/cohorts/${cohortId}/office_hours/${officeHourId}`, { method: 'DELETE' }),

  // Private, bookable student meetings
  getPrivateMeetings: () =>
    fetchApi<PrivateMeetingsResponse>('/api/v1/private_meetings'),
  bookPrivateMeeting: (slotId: number) =>
    fetchApi<unknown>('/api/v1/private_meetings', { method: 'POST', body: JSON.stringify({ slot_id: slotId }) }),
  reschedulePrivateMeeting: (bookingId: number, slotId: number) =>
    fetchApi<unknown>(`/api/v1/private_meetings/${bookingId}`, { method: 'PATCH', body: JSON.stringify({ slot_id: slotId }) }),
  cancelPrivateMeeting: (bookingId: number) =>
    fetchApi<unknown>(`/api/v1/private_meetings/${bookingId}`, { method: 'DELETE' }),
  getStaffPrivateMeetings: (params?: { cohort_id?: number; student_id?: number }) =>
    fetchApi<StaffPrivateMeetingsResponse>(`/api/v1/staff/private_meetings${queryString(params || {})}`),
  configurePrivateMeetings: (cohortId: number, instructorId: number) =>
    fetchApi<unknown>('/api/v1/staff/private_meeting_configs', { method: 'POST', body: JSON.stringify({ cohort_id: cohortId, instructor_id: instructorId }) }),
  createPrivateMeetingSlot: (cohortId: number, startsAt: string, repeatWeeks: number) =>
    fetchApi<unknown>('/api/v1/staff/private_meeting_slots', { method: 'POST', body: JSON.stringify({ cohort_id: cohortId, starts_at: startsAt, repeat_weeks: repeatWeeks }) }),
  deletePrivateMeetingSlot: (slotId: number) =>
    fetchApi<unknown>(`/api/v1/staff/private_meeting_slots/${slotId}`, { method: 'DELETE' }),
  updateStaffPrivateMeeting: (bookingId: number, data: { zoom_url?: string; slot_id?: number; status?: 'canceled' }) =>
    fetchApi<unknown>(`/api/v1/staff/private_meetings/${bookingId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Admin — Enrollments
  createEnrollment: (cohortId: number, userId: number, sendInvite = false) =>
    fetchApi<EnrollmentResponse>(`/api/v1/cohorts/${cohortId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, send_invite: sendInvite }),
    }),
  getEnrollment: (id: number) =>
    fetchApi<EnrollmentResponse>(`/api/v1/enrollments/${id}`),

  updateEnrollment: (id: number, data: { status: string }) =>
    fetchApi<EnrollmentResponse>(`/api/v1/enrollments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteEnrollment: (id: number) =>
    fetchApi<null>(`/api/v1/enrollments/${id}`, { method: 'DELETE' }),

  // Admin — Module Assignments
  getModuleAssignments: (enrollmentId: number) =>
    fetchApi<ModuleAssignmentsListResponse>(`/api/v1/enrollments/${enrollmentId}/module_assignments`),
  createModuleAssignment: (enrollmentId: number, data: { module_id: number; unlocked?: boolean; unlock_date_override?: string | null }) =>
    fetchApi<ModuleAssignmentResponse>(`/api/v1/enrollments/${enrollmentId}/module_assignments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateModuleAssignment: (id: number, data: { unlocked?: boolean; unlock_date_override?: string | null }) =>
    fetchApi<ModuleAssignmentResponse>(`/api/v1/module_assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteModuleAssignment: (id: number) =>
    fetchApi<null>(`/api/v1/module_assignments/${id}`, { method: 'DELETE' }),

  // Admin — Lesson Assignments
  getLessonAssignments: (enrollmentId: number) =>
    fetchApi<LessonAssignmentsListResponse>(`/api/v1/enrollments/${enrollmentId}/lesson_assignments`),
  createLessonAssignment: (enrollmentId: number, data: { lesson_id: number; unlocked?: boolean; unlock_date_override?: string | null }) =>
    fetchApi<LessonAssignmentResponse>(`/api/v1/enrollments/${enrollmentId}/lesson_assignments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLessonAssignment: (id: number, data: { unlocked?: boolean; unlock_date_override?: string | null }) =>
    fetchApi<LessonAssignmentResponse>(`/api/v1/lesson_assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteLessonAssignment: (id: number) =>
    fetchApi<null>(`/api/v1/lesson_assignments/${id}`, { method: 'DELETE' }),

  // Admin — Content
  updateContentBlock: (id: number, data: { block_type?: string; position?: number; title?: string; body?: string | null; video_url?: string | null; solution?: string | null; filename?: string | null; submission_type?: string | null; submission_config?: Record<string, unknown>; metadata?: Record<string, unknown>; s3_video_key?: string | null; s3_video_content_type?: string | null; s3_video_size?: number | null; s3_video_duration_seconds?: number | null }) =>
    fetchApi<ContentBlockResponse>(`/api/v1/content_blocks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  createLesson: (moduleId: number, data: { title: string; lesson_type?: string; position?: number; release_day?: number; required?: boolean; requires_submission?: boolean; published?: boolean }) =>
    fetchApi<LessonResponse>(`/api/v1/modules/${moduleId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLesson: (id: number, data: { base_updated_at: string; title?: string; required?: boolean; requires_submission?: boolean; release_day?: number; published?: boolean }) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getLessonBlockEditor: (id: number) =>
    fetchApi<LessonBlockEditorResponse>(`/api/v1/lessons/${id}/block_editor`, { cache: 'no-store' }),
  getExerciseCheckPolicy: (blockId: number) =>
    fetchApi<components['schemas']['ExerciseCheckPolicyResponse']>(`/api/v1/content_blocks/${blockId}/check_policy`, { cache: 'no-store' }),
  saveExerciseCheckPolicy: (blockId: number, rules: components['schemas']['ExerciseCheckPolicyInput']) =>
    fetchApi<components['schemas']['ExerciseCheckPolicyResponse']>(`/api/v1/content_blocks/${blockId}/check_policy`, { method: 'PUT', body: JSON.stringify(rules) }),
  deactivateExerciseCheckPolicy: (blockId: number) =>
    fetchApi<components['schemas']['ExerciseCheckPolicyResponse']>(`/api/v1/content_blocks/${blockId}/check_policy`, { method: 'DELETE' }),
  saveLessonBlockEditor: (id: number, lesson: LessonBlockEditorInput['lesson']) =>
    fetchApi<LessonBlockEditorResponse>(`/api/v1/lessons/${id}/block_editor`, {
      method: 'PUT',
      body: JSON.stringify({ lesson }),
    }),
  moveLesson: (id: number, data: { module_id: number; release_day: number; position: number; base_updated_at: string; dry_run?: boolean; expected_impact?: { learners_losing_access: number; learners_gaining_access: number; self_paced_learners: boolean } }) =>
    fetchApi<import('../types/api').LessonMoveResult>(`/api/v1/lessons/${id}/move`, { method: 'POST', body: JSON.stringify(data) }),
  /** "Make a copy for this cohort": dry run (GET) and copy (POST). */
  getCurriculumCopyPreview: (cohortId: number, sourceCurriculumId: number) =>
    fetchApi<import('../types/api').CurriculumCopyPreviewResponse>(`/api/v1/cohorts/${cohortId}/curriculum_copy?source_curriculum_id=${sourceCurriculumId}`, { cache: 'no-store' }),
  // A large copy takes several seconds on Neon (one transaction, ~390
  // statements), so it gets 30 s rather than the 12 s default. A client that
  // still gives up can repeat the request: the server answers with the copy
  // it already made (200, already_copied).
  copyCurriculumForCohort: (cohortId: number, sourceCurriculumId: number) =>
    fetchApi<import('../types/api').CurriculumCopyResponse>(`/api/v1/cohorts/${cohortId}/curriculum_copy`, { method: 'POST', body: JSON.stringify({ source_curriculum_id: sourceCurriculumId }) }, true, CURRICULUM_COPY_TIMEOUT_MS),
  duplicateLesson: (id: number) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}/duplicate`, { method: 'POST' }),
  archiveLesson: (id: number, baseUpdatedAt: string) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ base_updated_at: baseUpdatedAt }) }),
  restoreLesson: (id: number, baseUpdatedAt: string) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}/restore`, { method: 'PATCH', body: JSON.stringify({ base_updated_at: baseUpdatedAt }) }),
  deleteLesson: (id: number) =>
    fetchApi<void>(`/api/v1/lessons/${id}`, { method: 'DELETE' }),
  getLearningObjectives: (curriculumId: number) =>
    fetchApi<{ learning_objectives: import('../types/api').LearningObjective[] }>(`/api/v1/learning_objectives?curriculum_id=${curriculumId}`),
  getRubrics: (curriculumId: number) =>
    fetchApi<{ rubrics: import('../types/api').Rubric[] }>(`/api/v1/rubrics?curriculum_id=${curriculumId}`),
  createRubric: (data: { curriculum_id: number; title: string; description?: string; criteria: { title: string; description: string; learning_objective_id?: number | null }[] }) =>
    fetchApi<{ rubric: import('../types/api').Rubric }>('/api/v1/rubrics', {
      method: 'POST',
      body: JSON.stringify({ rubric: data }),
    }),
  createLearningObjective: (data: { curriculum_id: number; code: string; title: string; description?: string; success_criteria: string; position?: number; active?: boolean; lesson_id?: number }) => {
    const { lesson_id, ...objective } = data
    return fetchApi<{ learning_objective: import('../types/api').LearningObjective }>('/api/v1/learning_objectives', {
      method: 'POST',
      body: JSON.stringify({ learning_objective: objective, lesson_id }),
    })
  },
  updateLearningObjective: (id: number, data: Partial<{ code: string; title: string; description: string; success_criteria: string; position: number; active: boolean }>) =>
    fetchApi<{ learning_objective: import('../types/api').LearningObjective }>(`/api/v1/learning_objectives/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ learning_objective: data }),
    }),
  updateObjectiveAlignments: (lessonId: number, alignments: { learning_objective_id: number; content_block_id?: number | null }[]) =>
    fetchApi<{ objectives: import('../types/api').LessonObjective[] }>(`/api/v1/lessons/${lessonId}/objective_alignments`, {
      method: 'PUT',
      body: JSON.stringify({ alignments }),
    }),
  createExercise: (moduleId: number, data: { title: string; release_day: number; required?: boolean; published?: boolean; video_url?: string; instructions?: string; solution?: string; filename?: string; requires_submission?: boolean; submission_type?: string; submission_config?: Record<string, unknown>; s3_video_key?: string; s3_video_content_type?: string; s3_video_size?: number; video_upload_pending?: boolean }) =>
    fetchApi<LessonResponse>(`/api/v1/modules/${moduleId}/exercises`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCurriculum: (id: number, data: { base_updated_at: string; name?: string; description?: string; status?: string; grading_scale?: GradingScale }) =>
    fetchApi<CurriculumResponse>(`/api/v1/curricula/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reorderModules: (id: number, moduleIds: number[]) =>
    fetchApi<null>(`/api/v1/curricula/${id}/modules/reorder`, { method: 'POST', body: JSON.stringify({ module_ids: moduleIds }) }),
  deleteCurriculum: (id: number) =>
    fetchApi<null>(`/api/v1/curricula/${id}`, { method: 'DELETE' }),
  deleteModule: (id: number) =>
    fetchApi<null>(`/api/v1/modules/${id}`, { method: 'DELETE' }),
  createModule: (curriculumId: number, data: { name: string; module_type?: string; description?: string; position?: number; total_days?: number; day_offset?: number; schedule_days?: string }) =>
    fetchApi<components['schemas']['ModuleResponseMutation']>(`/api/v1/curricula/${curriculumId}/modules`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateModule: (id: number, data: { base_updated_at: string; name?: string; module_type?: string; description?: string; position?: number; total_days?: number; day_offset?: number; schedule_days?: string }) =>
    fetchApi<components['schemas']['ModuleResponseMutation']>(`/api/v1/modules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  createContentBlock: (lessonId: number, data: { block_type: string; position?: number; title?: string; body?: string; video_url?: string; solution?: string; filename?: string; submission_type?: string; submission_config?: Record<string, unknown>; metadata?: Record<string, unknown>; s3_video_key?: string; s3_video_content_type?: string; s3_video_size?: number }) =>
    fetchApi<ContentBlockResponse>(`/api/v1/lessons/${lessonId}/content_blocks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteContentBlock: (id: number) =>
    fetchApi<null>(`/api/v1/content_blocks/${id}`, { method: 'DELETE' }),
  getContentBlocks: (lessonId: number) =>
    fetchApi<ContentBlocksListResponse>(`/api/v1/lessons/${lessonId}/content_blocks`),

  // Content block video (S3)
  presignGenericVideo: (filename: string, contentType: string) =>
    fetchApi<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(
      `/api/v1/video_presign`,
      { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) }
    ),
  presignContentBlockVideo: (blockId: number, filename: string, contentType: string) =>
    fetchApi<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(
      `/api/v1/content_blocks/${blockId}/video_presign`,
      { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) }
    ),
  getContentBlockVideoStream: (blockId: number, cohortId?: number, versionId?: string) =>
    fetchApi<VideoStreamResponse>(`/api/v1/content_blocks/${blockId}/video_stream${queryString({ cohort_id: cohortId, version_id: versionId })}`),
  updateContentBlockVideoProgress: (blockId: number, data: Omit<VideoProgressInput, 'cohort_id'>, cohortId?: number) =>
    fetchApi<VideoProgressResponse>(`/api/v1/content_blocks/${blockId}/video_progress`, {
      method: 'PATCH', body: JSON.stringify({ ...data, cohort_id: cohortId, watch_credit_version: 2 }),
    }),

  // Cohort-scoped grading
  getCohortModuleSubmissions: (cohortId: number, moduleId: number, signal?: AbortSignal) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/submissions`, signal ? { signal } : {}),
  syncCohortModuleGithub: (cohortId: number, moduleId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/sync_github`, { method: 'POST' }),
  syncStudentGithub: (cohortId: number, moduleId: number, userId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/sync_github/${userId}`, { method: 'POST' }),

  // S3 Recordings
  getCohortRecordings: (cohortId: number) =>
    fetchApi<CohortRecordingsResponse>(`/api/v1/cohorts/${cohortId}/recordings`),
  getRecordingLessonOptions: (cohortId: number) =>
    fetchApi<components['schemas']['RecordingLessonOptionsResponse']>(`/api/v1/cohorts/${cohortId}/recordings/lesson_options`),
  presignRecordingUpload: (cohortId: number, filename: string, contentType: string) =>
    fetchApi<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(
      `/api/v1/cohorts/${cohortId}/recordings_presign`,
      { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) }
    ),
  createRecording: (cohortId: number, data: components['schemas']['CreateRecordingInput']) =>
    fetchApi<RecordingResponse>(`/api/v1/cohorts/${cohortId}/recordings`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateRecording: (cohortId: number, id: number, data: components['schemas']['UpdateRecordingInput']) =>
    fetchApi<RecordingResponse>(`/api/v1/cohorts/${cohortId}/recordings/${id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  deleteRecording: (cohortId: number, id: number) =>
    fetchApi<null>(`/api/v1/cohorts/${cohortId}/recordings/${id}`, { method: 'DELETE' }),
  getRecordingStreamUrl: (cohortId: number, id: number) =>
    fetchApi<{ stream_url: string }>(`/api/v1/cohorts/${cohortId}/recordings/${id}/stream_url`),
  reorderRecordings: (cohortId: number, recordingIds: number[]) =>
    fetchApi<ReorderRecordingsResponse>(`/api/v1/cohorts/${cohortId}/recordings_reorder`, {
      method: 'PATCH', body: JSON.stringify({ recording_ids: recordingIds }),
    }),
  abandonUpload: (s3Key: string) =>
    fetchApi<null>('/api/v1/uploads/abandon', {
      method: 'DELETE', body: JSON.stringify({ s3_key: s3Key }),
    }),
  initiateMultipartUpload: (data: { filename: string; content_type: string; file_size: number; cohort_id?: number; content_block_id?: number }, signal?: AbortSignal) =>
    fetchApi<{ s3_key: string; upload_id: string }>('/api/v1/uploads/multipart/initiate', {
      method: 'POST', body: JSON.stringify(data), signal,
    }),
  getMultipartUploadPartUrl: (data: { s3_key: string; upload_id: string; part_number: number }, signal?: AbortSignal) =>
    fetchApi<{ upload_url: string }>('/api/v1/uploads/multipart/part_url', {
      method: 'POST', body: JSON.stringify(data), signal,
    }),
  completeMultipartUpload: (data: { s3_key: string; upload_id: string; parts: Array<{ part_number: number; etag: string }> }) =>
    fetchApi<null>('/api/v1/uploads/multipart/complete', {
      method: 'POST', body: JSON.stringify(data),
    }),
  abortMultipartUpload: (data: { s3_key: string; upload_id: string }) =>
    fetchApi<null>('/api/v1/uploads/multipart/abort', {
      method: 'DELETE', body: JSON.stringify(data),
    }),

  // Watch Progress
  updateWatchProgress: (data: WatchProgressInput) =>
    fetchApi<WatchProgressUpdateResponse>('/api/v1/watch_progress', {
      method: 'PATCH', body: JSON.stringify({ ...data, watch_credit_version: 2 }),
    }),
  getCohortWatchProgress: (cohortId: number) =>
    fetchApi<CohortWatchProgressResponse>(`/api/v1/cohorts/${cohortId}/watch_progress`),
  getCohortLessonVideoProgress: (cohortId: number) =>
    fetchApi<CohortLessonVideoProgressResponse>(`/api/v1/cohorts/${cohortId}/lesson_video_progress`),
  getStudentWatchProgress: (userId: number, cohortId?: number) =>
    fetchApi<StudentWatchProgressResponse>(`/api/v1/watch_progress/student/${userId}${queryString({ cohort_id: cohortId })}`),
  getStudentLessonVideoProgress: (userId: number, cohortId?: number) =>
    fetchApi<StudentLessonVideoProgressResponse>(`/api/v1/watch_progress/student/${userId}/lesson_videos${queryString({ cohort_id: cohortId })}`),
};

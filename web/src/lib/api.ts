import type {
  SessionResponse,
  DashboardResponse,
  RecordingsResponse,
  ResourcesResponse,
  ProfileResponse,
  ProfileUpdateResponse,
  ModuleResponse,
  LessonResponse,
  ProgressUpdateResponse,
  SubmissionsListResponse,
  SubmissionResponse,
  StudentProgressResponse,
  UsersListResponse,
  UserDetailResponse,
  UserUpdateResponse,
  CurriculaListResponse,
  CurriculumResponse,
  CohortsListResponse,
  CohortResponse,
  CohortStudentViewResponse,
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
  PushConfigResponse,
  PushSubscriptionResponse,
  CableTokenResponse,
  WorkspacesResponse,
  WorkspaceResponse,
  ChannelsResponse,
  ChannelResponse,
  MessageResponse,
  DirectConversationsResponse,
  DirectConversationResponse,
  AvailableDirectUsersResponse,
  MessageAttachmentPresignResponse,
  MessagePreferenceResponse,
  MessageSearchResponse,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 12_000;
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
  fromCache?: boolean;
  cacheAgeMs?: number;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<ApiResponse<T>> {
  const method = (options.method || 'GET').toUpperCase();
  const canRetry = method === 'GET' || method === 'HEAD';
  const cacheScope = apiCacheScope;
  const canUseCache = requireAuth && method === 'GET' && Boolean(cacheScope);
  const maxAttempts = canRetry ? 3 : 1;
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
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const error = errorMessage(errorBody, response.status);
        const retryUnauthorized = canRetry && response.status === 401 && !didRetryUnauthorized;
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
            return { ...cached, error, status: response.status, errorKind: errorKindForStatus(response.status) };
          }
        }

        return {
          data: null,
          error,
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
      if (canUseCache && shouldCacheResponse(endpoint, data)) writeCachedResponse(cacheScope, endpoint, data);
      return { data, error: null, status: response.status };
    } catch (err) {
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

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

  if (endpoint === '/api/v1/dashboard') {
    const dashboard = (data as { dashboard?: { enrolled?: boolean } }).dashboard;
    return typeof dashboard?.enrolled === 'boolean';
  }

  if (endpoint === '/api/v1/resources') {
    const resources = (data as { resources?: unknown[] }).resources;
    return Array.isArray(resources);
  }

  if (endpoint === '/api/v1/recordings') {
    const response = data as { recordings?: unknown[]; s3_recordings?: unknown[] };
    return Array.isArray(response.recordings) || Array.isArray(response.s3_recordings);
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

export const api = {
  // Auth
  createSession: () =>
    fetchApi<SessionResponse>('/api/v1/sessions', { method: 'POST' }),
  updatePresence: () =>
    fetchApi<{ last_seen_at: string }>('/api/v1/presence', { method: 'POST' }),

  // Dashboard
  getDashboard: () =>
    fetchApi<DashboardResponse>('/api/v1/dashboard'),
  getRecordings: () =>
    fetchApi<RecordingsResponse>('/api/v1/recordings'),
  getResources: () =>
    fetchApi<ResourcesResponse>('/api/v1/resources'),
  getAnnouncements: (params?: {
    scope?: 'manage';
    page?: number;
    per_page?: number;
    audience?: 'cohort' | 'global' | 'staff';
    status?: 'draft' | 'published' | 'archived';
    cohort_id?: number | null;
    read?: 'read' | 'unread';
    sort?: 'published_desc' | 'published_asc' | 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc';
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
  createAnnouncement: (data: { title: string; body: string; audience: string; cohort_id?: number | null; status?: string; pinned?: boolean; send_push?: boolean }) =>
    fetchApi<AnnouncementResponse>('/api/v1/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAnnouncement: (id: number, data: { title?: string; body?: string; audience?: string; cohort_id?: number | null; status?: string; pinned?: boolean; send_push?: boolean }) =>
    fetchApi<AnnouncementResponse>(`/api/v1/announcements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
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
  createPushSubscription: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    fetchApi<PushSubscriptionResponse>('/api/v1/push_subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  deletePushSubscription: (endpoint: string) =>
    fetchApi<null>('/api/v1/push_subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
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
    fetchApi<ChannelsResponse>('/api/v1/channels'),
  getChannel: (id: number, params?: { message_limit?: number; around_message_id?: number }) =>
    fetchApi<ChannelResponse>(`/api/v1/channels/${id}${queryString(params)}`),
  createChannel: (data: { workspace_id?: number; cohort_id?: number; name: string; description?: string; visibility?: string }) =>
    fetchApi<ChannelResponse>('/api/v1/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  markChannelRead: (id: number) =>
    fetchApi<ChannelResponse>(`/api/v1/channels/${id}/read`, { method: 'PATCH' }),
  createMessage: (channelId: number, data: { body: string; parent_message_id?: number | null; mention_user_ids?: number[]; attachments?: { s3_key: string; filename: string; content_type: string; byte_size: number }[]; send_push?: boolean }) =>
    fetchApi<MessageResponse>(`/api/v1/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDirectConversations: () =>
    fetchApi<DirectConversationsResponse>('/api/v1/direct_conversations'),
  getAvailableDirectUsers: (workspaceId: number) =>
    fetchApi<AvailableDirectUsersResponse>(`/api/v1/direct_conversations/available_users?workspace_id=${workspaceId}`),
  getDirectConversation: (id: number, params?: { message_limit?: number; around_message_id?: number }) =>
    fetchApi<DirectConversationResponse>(`/api/v1/direct_conversations/${id}${queryString(params)}`),
  createDirectConversation: (data: { workspace_id?: number; cohort_id?: number; user_ids: number[] }) =>
    fetchApi<DirectConversationResponse>('/api/v1/direct_conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  markDirectConversationRead: (id: number) =>
    fetchApi<DirectConversationResponse>(`/api/v1/direct_conversations/${id}/read`, { method: 'PATCH' }),
  createDirectMessage: (conversationId: number, data: { body: string; parent_message_id?: number | null; mention_user_ids?: number[]; attachments?: { s3_key: string; filename: string; content_type: string; byte_size: number }[]; send_push?: boolean }) =>
    fetchApi<MessageResponse>(`/api/v1/direct_conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
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
  searchMessages: (q: string, limit = 30) =>
    fetchApi<MessageSearchResponse>(`/api/v1/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // Profile
  getProfile: () =>
    fetchApi<ProfileResponse>('/api/v1/profile'),
  updateProfile: (data: { github_username?: string; avatar_url?: string }) =>
    fetchApi<ProfileUpdateResponse>('/api/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Modules
  getModule: (id: number) =>
    fetchApi<ModuleResponse>(`/api/v1/modules/${id}`),

  // Lessons
  getLesson: (id: number) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}`),

  // Progress
  updateProgress: (contentBlockId: number, status: string) =>
    fetchApi<ProgressUpdateResponse>('/api/v1/progress', {
      method: 'PATCH',
      body: JSON.stringify({ content_block_id: contentBlockId, status }),
    }),

  // Submissions
  getSubmissions: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<SubmissionsListResponse>(`/api/v1/submissions${query}`);
  },
  getSubmission: (id: number) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}`),
  createSubmission: (data: { content_block_id: number; text?: string; github_issue_url?: string; github_code_url?: string; repo_url?: string; pr_url?: string; live_url?: string; branch?: string; commit_sha?: string; notes?: string }) =>
    fetchApi<SubmissionResponse>('/api/v1/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  gradeSubmission: (id: number, data: { grade: string; feedback?: string }) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}/grade`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getSubmissionGithubIssue: (id: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/submissions/${id}/github_issue`),

  // Student progress (admin)
  getStudentProgress: (userId: number) =>
    fetchApi<StudentProgressResponse>(`/api/v1/progress/student/${userId}`),

  // Admin — Users
  getUsers: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<UsersListResponse>(`/api/v1/users${query}`);
  },
  createUser: (data: { email: string; role?: string; github_username?: string; skip_invite?: boolean }) =>
    fetchApi<{ user: { id: number; email: string; full_name: string; role: string } }>('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resendInvite: (userId: number) =>
    fetchApi<{ message: string }>(`/api/v1/users/${userId}/resend_invite`, {
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

  // Admin — Curricula
  getCurricula: () =>
    fetchApi<CurriculaListResponse>('/api/v1/curricula'),
  getCurriculum: (id: number) =>
    fetchApi<CurriculumResponse>(`/api/v1/curricula/${id}`),

  // Admin — Cohorts
  getCohorts: () =>
    fetchApi<CohortsListResponse>('/api/v1/cohorts'),
  getCohort: (id: number) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${id}`),
  getCohortStudentView: (id: number) =>
    fetchApi<CohortStudentViewResponse>(`/api/v1/cohorts/${id}/student_view`),
  createCohort: (data: { name: string; cohort_type: string; curriculum_id: number; start_date: string; end_date?: string; status?: string }) =>
    fetchApi<CohortResponse>('/api/v1/cohorts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCohort: (id: number, data: { name?: string; start_date?: string; end_date?: string; status?: string }) =>
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
  updateCohortRecordings: (cohortId: number, recordings: { title: string; url: string; date?: string; description?: string }[]) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/recordings`, {
      method: 'PATCH',
      body: JSON.stringify({ recordings }),
    }),
  updateCohortClassResources: (cohortId: number, classResources: { title: string; url: string; category?: string; description?: string }[]) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/class_resources`, {
      method: 'PATCH',
      body: JSON.stringify({ class_resources: classResources }),
    }),

  // Admin — Enrollments
  createEnrollment: (cohortId: number, userId: number) =>
    fetchApi<EnrollmentResponse>(`/api/v1/cohorts/${cohortId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  getEnrollment: (id: number) =>
    fetchApi<EnrollmentResponse>(`/api/v1/enrollments/${id}`),

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
  createLesson: (moduleId: number, data: { title: string; lesson_type?: string; position?: number; release_day?: number; required?: boolean; requires_submission?: boolean }) =>
    fetchApi<LessonResponse>(`/api/v1/modules/${moduleId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLesson: (id: number, data: { title?: string; requires_submission?: boolean; release_day?: number }) =>
    fetchApi<LessonResponse>(`/api/v1/lessons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteLesson: (id: number) =>
    fetchApi<void>(`/api/v1/lessons/${id}`, { method: 'DELETE' }),
  createExercise: (moduleId: number, data: { title: string; release_day: number; video_url?: string; instructions?: string; solution?: string; filename?: string; requires_submission?: boolean; submission_type?: string; submission_config?: Record<string, unknown>; s3_video_key?: string; s3_video_content_type?: string; s3_video_size?: number }) =>
    fetchApi<LessonResponse>(`/api/v1/modules/${moduleId}/exercises`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createModule: (curriculumId: number, data: { name: string; module_type?: string; description?: string; position?: number; total_days?: number; day_offset?: number; schedule_days?: string }) =>
    fetchApi<ModuleResponse>(`/api/v1/curricula/${curriculumId}/modules`, {
      method: 'POST',
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
  getContentBlockVideoStream: (blockId: number) =>
    fetchApi<VideoStreamResponse>(`/api/v1/content_blocks/${blockId}/video_stream`),
  updateContentBlockVideoProgress: (blockId: number, data: { last_position_seconds: number; total_watched_seconds: number; duration_seconds?: number }) =>
    fetchApi<VideoProgressResponse>(`/api/v1/content_blocks/${blockId}/video_progress`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),

  // Cohort-scoped grading
  getCohortModuleSubmissions: (cohortId: number, moduleId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/submissions`),
  syncCohortModuleGithub: (cohortId: number, moduleId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/sync_github`, { method: 'POST' }),
  syncStudentGithub: (cohortId: number, moduleId: number, userId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/modules/${moduleId}/sync_github/${userId}`, { method: 'POST' }),

  // S3 Recordings
  getCohortRecordings: (cohortId: number) =>
    fetchApi<CohortRecordingsResponse>(`/api/v1/cohorts/${cohortId}/recordings`),
  presignRecordingUpload: (cohortId: number, filename: string, contentType: string) =>
    fetchApi<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(
      `/api/v1/cohorts/${cohortId}/recordings_presign`,
      { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) }
    ),
  createRecording: (cohortId: number, data: { title: string; description?: string; s3_key: string; content_type: string; file_size: number; duration_seconds?: number; recorded_date?: string }) =>
    fetchApi<RecordingResponse>(`/api/v1/cohorts/${cohortId}/recordings`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateRecording: (cohortId: number, id: number, data: { title?: string; description?: string; duration_seconds?: number; recorded_date?: string | null }) =>
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
  updateWatchProgress: (data: { recording_id: number; last_position_seconds: number; total_watched_seconds: number; duration_seconds?: number }) =>
    fetchApi<WatchProgressUpdateResponse>('/api/v1/watch_progress', {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  getCohortWatchProgress: (cohortId: number) =>
    fetchApi<CohortWatchProgressResponse>(`/api/v1/cohorts/${cohortId}/watch_progress`),
  getCohortLessonVideoProgress: (cohortId: number) =>
    fetchApi<CohortLessonVideoProgressResponse>(`/api/v1/cohorts/${cohortId}/lesson_video_progress`),
  getStudentWatchProgress: (userId: number) =>
    fetchApi<StudentWatchProgressResponse>(`/api/v1/watch_progress/student/${userId}`),
  getStudentLessonVideoProgress: (userId: number) =>
    fetchApi<StudentLessonVideoProgressResponse>(`/api/v1/watch_progress/student/${userId}/lesson_videos`),
};

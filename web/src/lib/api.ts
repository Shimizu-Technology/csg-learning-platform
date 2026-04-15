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
  EnrollmentResponse,
  ModuleAssignmentsListResponse,
  ModuleAssignmentResponse,
  LessonAssignmentsListResponse,
  LessonAssignmentResponse,
  ContentBlockResponse,
  ContentBlocksListResponse,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

let getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  getAuthToken = getter;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (requireAuth && getAuthToken) {
    const token = await getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        data: null,
        error: errorBody.error || `Request failed with status ${response.status}`,
      };
    }

    if (response.status === 204) {
      return { data: null, error: null };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export const api = {
  // Auth
  createSession: () =>
    fetchApi<SessionResponse>('/api/v1/sessions', { method: 'POST' }),

  // Dashboard
  getDashboard: () =>
    fetchApi<DashboardResponse>('/api/v1/dashboard'),
  getRecordings: () =>
    fetchApi<RecordingsResponse>('/api/v1/recordings'),
  getResources: () =>
    fetchApi<ResourcesResponse>('/api/v1/resources'),

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
  createSubmission: (data: { content_block_id: number; text: string; github_issue_url?: string; github_code_url?: string }) =>
    fetchApi<SubmissionResponse>('/api/v1/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  gradeSubmission: (id: number, data: { grade: string; feedback?: string }) =>
    fetchApi<SubmissionResponse>(`/api/v1/submissions/${id}/grade`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSubmissionGithubIssue: (id: number) =>
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
    fetchApi<{ message: string }>(`/api/v1/users/${id}`, { method: 'DELETE' }),

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
  updateCohortModuleAccess: (cohortId: number, data: { module_id: number; assigned?: boolean; unlocked?: boolean; unlock_date_override?: string | null; requires_github?: boolean; repository_name?: string }) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/module_access`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateCohortAnnouncements: (cohortId: number, announcements: { title: string; body: string; pinned?: boolean; published_at?: string }[]) =>
    fetchApi<CohortResponse>(`/api/v1/cohorts/${cohortId}/announcements`, {
      method: 'PATCH',
      body: JSON.stringify({ announcements }),
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
  updateContentBlock: (id: number, data: { block_type?: string; position?: number; title?: string; body?: string | null; video_url?: string | null; solution?: string | null; filename?: string | null; metadata?: Record<string, unknown> }) =>
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
  createExercise: (moduleId: number, data: { title: string; release_day: number; video_url?: string; instructions?: string; solution?: string; filename?: string; requires_submission: boolean }) =>
    fetchApi<LessonResponse>(`/api/v1/modules/${moduleId}/exercises`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createModule: (curriculumId: number, data: { name: string; module_type?: string; description?: string; position?: number; total_days?: number; day_offset?: number; schedule_days?: string }) =>
    fetchApi<ModuleResponse>(`/api/v1/curricula/${curriculumId}/modules`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createContentBlock: (lessonId: number, data: { block_type: string; position?: number; title?: string; body?: string; video_url?: string; solution?: string; filename?: string; metadata?: Record<string, unknown> }) =>
    fetchApi<ContentBlockResponse>(`/api/v1/lessons/${lessonId}/content_blocks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteContentBlock: (id: number) =>
    fetchApi<null>(`/api/v1/content_blocks/${id}`, { method: 'DELETE' }),
  getContentBlocks: (lessonId: number) =>
    fetchApi<ContentBlocksListResponse>(`/api/v1/lessons/${lessonId}/content_blocks`),

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/recordings`),
  presignRecordingUpload: (cohortId: number, filename: string, contentType: string) =>
    fetchApi<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(
      `/api/v1/cohorts/${cohortId}/recordings_presign`,
      { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) }
    ),
  createRecording: (cohortId: number, data: { title: string; description?: string; s3_key: string; content_type: string; file_size: number; duration_seconds?: number; recorded_date?: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/recordings`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateRecording: (cohortId: number, id: number, data: { title?: string; description?: string; duration_seconds?: number; recorded_date?: string; position?: number }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/recordings/${id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  deleteRecording: (cohortId: number, id: number) =>
    fetchApi<null>(`/api/v1/cohorts/${cohortId}/recordings/${id}`, { method: 'DELETE' }),
  getRecordingStreamUrl: (cohortId: number, id: number) =>
    fetchApi<{ stream_url: string }>(`/api/v1/cohorts/${cohortId}/recordings/${id}/stream_url`),
  reorderRecordings: (cohortId: number, recordingIds: number[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/recordings_reorder`, {
      method: 'PATCH', body: JSON.stringify({ recording_ids: recordingIds }),
    }),

  // Watch Progress
  updateWatchProgress: (data: { recording_id: number; last_position_seconds: number; total_watched_seconds: number; duration_seconds?: number }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>('/api/v1/watch_progress', {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  getCohortWatchProgress: (cohortId: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/watch_progress`),
};

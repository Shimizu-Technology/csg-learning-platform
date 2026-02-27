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
  createSession: () => fetchApi<any>('/api/v1/sessions', { method: 'POST' }),

  // Dashboard
  getDashboard: () => fetchApi<any>('/api/v1/dashboard'),

  // Profile
  getProfile: () => fetchApi<any>('/api/v1/profile'),
  updateProfile: (data: any) =>
    fetchApi<any>('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  // Modules
  getModule: (id: number) => fetchApi<any>(`/api/v1/modules/${id}`),

  // Lessons
  getLesson: (id: number) => fetchApi<any>(`/api/v1/lessons/${id}`),

  // Progress
  updateProgress: (contentBlockId: number, status: string) =>
    fetchApi<any>('/api/v1/progress', {
      method: 'PATCH',
      body: JSON.stringify({ content_block_id: contentBlockId, status }),
    }),

  // Submissions
  getSubmissions: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<any>(`/api/v1/submissions${query}`);
  },
  createSubmission: (data: any) =>
    fetchApi<any>('/api/v1/submissions', { method: 'POST', body: JSON.stringify(data) }),
  gradeSubmission: (id: number, data: any) =>
    fetchApi<any>(`/api/v1/submissions/${id}/grade`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Admin
  getUsers: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<any>(`/api/v1/users${query}`);
  },
  getUser: (id: number) => fetchApi<any>(`/api/v1/users/${id}`),
  updateUser: (id: number, data: any) =>
    fetchApi<any>(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getCurricula: () => fetchApi<any>('/api/v1/curricula'),
  getCurriculum: (id: number) => fetchApi<any>(`/api/v1/curricula/${id}`),
  getCohorts: () => fetchApi<any>('/api/v1/cohorts'),
  getCohort: (id: number) => fetchApi<any>(`/api/v1/cohorts/${id}`),
  createEnrollment: (cohortId: number, userId: number) =>
    fetchApi<any>(`/api/v1/cohorts/${cohortId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  updateContentBlock: (id: number, data: any) =>
    fetchApi<any>(`/api/v1/content_blocks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createLesson: (moduleId: number, data: any) =>
    fetchApi<any>(`/api/v1/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(data) }),
  createContentBlock: (lessonId: number, data: any) =>
    fetchApi<any>(`/api/v1/lessons/${lessonId}/content_blocks`, { method: 'POST', body: JSON.stringify(data) }),
};

import type {
  Announcement,
  AppNotification,
  ChannelSummary,
  ConversationPayload,
  DirectConversationSummary,
  Message,
  MessageEvent,
  MessageSearchResult,
  PaginationMeta,
  ProfilePayload,
  LearningResource,
  LessonDetail,
  RecordingItem,
  ContentVideoProgress,
  ProgressEntry,
  PushConfig,
  SessionUser,
  StaffDashboard,
  StudentDashboard,
  Submission,
  SubmissionInput,
  UploadAttachmentInput,
  UserSummary,
  VideoProgressInput,
  WatchProgress,
  WorkspaceDetail,
  WorkspaceSummary,
} from './types';

export type TokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null>;

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
}

type MessageInput = {
  body: string;
  parent_message_id?: number | null;
  mention_user_ids?: number[];
  attachments?: UploadAttachmentInput[];
  send_push?: boolean;
};

type ConversationOptions = {
  message_limit?: number;
  around_message_id?: number;
  before_message_id?: number;
};

function queryString(values: Record<string, string | number | boolean | null | undefined>) {
  const query = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `?${query}` : '';
}

export class CsgApi {
  constructor(private readonly getToken: TokenGetter) {}

  async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const cancel = () => controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    if (init.signal?.aborted) cancel();
    try {
      const token = await this.getToken({ skipCache: attempt > 0 });
      const response = await fetch(`${API_URL}${path}`, {
        ...init, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; errors?: string[]; code?: string };
        const getRequest = !init.method || init.method === 'GET';
        if (attempt === 0 && (response.status === 401 || (getRequest && RETRYABLE.has(response.status)))) {
          return this.request<T>(path, init, attempt + 1);
        }
        throw new ApiError(payload.error || payload.errors?.join(', ') || `Request failed (${response.status})`, response.status, payload.code);
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as Error).name === 'AbortError' && init.signal?.aborted) throw error;
      if ((error as Error).name === 'AbortError') throw new ApiError('The request timed out. Check your connection and try again.');
      throw new ApiError('Could not reach Code School. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', cancel);
    }
  }

  session = () => this.request<{ user: SessionUser }>('/api/v1/sessions', { method: 'POST' });
  dashboard = (signal?: AbortSignal) => this.request<{ dashboard: StudentDashboard | StaffDashboard }>('/api/v1/dashboard', { signal });
  profile = (signal?: AbortSignal) => this.request<ProfilePayload>('/api/v1/profile', { signal });
  updateProfile = (data: { github_username?: string | null }) => this.request<{ user: ProfilePayload['user'] }>('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(data) });
  webHandoff = (destination: string) => this.request<{ url: string }>('/api/v1/web_handoffs', { method: 'POST', body: JSON.stringify({ destination }) });
  resources = (signal?: AbortSignal) => this.request<{ resources: LearningResource[] }>('/api/v1/resources', { signal });
  lesson = (id: number, signal?: AbortSignal) => this.request<{ lesson: LessonDetail }>(`/api/v1/lessons/${id}`, { signal });
  progress = (lessonId: number, signal?: AbortSignal) => this.request<{ progress: ProgressEntry[] }>(`/api/v1/progress?lesson_id=${lessonId}`, { signal });
  updateProgress = (contentBlockId: number, status: string) => this.request<{ progress: ProgressEntry }>('/api/v1/progress', { method: 'PATCH', body: JSON.stringify({ content_block_id: contentBlockId, status }) });
  createSubmission = (input: SubmissionInput) => this.request<{ submission: Submission }>('/api/v1/submissions', { method: 'POST', body: JSON.stringify(input) });
  updateSubmission = (id: number, input: Omit<SubmissionInput, 'content_block_id'>) => this.request<{ submission: Submission }>(`/api/v1/submissions/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  contentVideoStream = (id: number, signal?: AbortSignal) => this.request<{ stream_url: string; expires_at: string; video_progress: ContentVideoProgress | null }>(`/api/v1/content_blocks/${id}/video_stream`, { signal });
  updateContentVideoProgress = (id: number, input: VideoProgressInput) => this.request<{ video_progress: ContentVideoProgress & { content_block_id: number; completed: boolean } }>(`/api/v1/content_blocks/${id}/video_progress`, { method: 'PATCH', body: JSON.stringify(input) });
  recordings = (signal?: AbortSignal) => this.request<{ recordings: RecordingItem[]; s3_recordings: RecordingItem[]; items: RecordingItem[] }>('/api/v1/recordings', { signal });
  recordingStream = (cohortId: number, recordingId: number, signal?: AbortSignal) => this.request<{ stream_url: string; expires_at: string }>(`/api/v1/cohorts/${cohortId}/recordings/${recordingId}/stream_url`, { signal });
  updateWatchProgress = (recordingId: number, input: VideoProgressInput) => this.request<{ watch_progress: WatchProgress }>('/api/v1/watch_progress', { method: 'PATCH', body: JSON.stringify({ recording_id: recordingId, ...input }) });
  workspaces = () => this.request<{ workspaces: WorkspaceSummary[] }>('/api/v1/workspaces');
  workspace = (id: number) => this.request<{ workspace: WorkspaceDetail }>(`/api/v1/workspaces/${id}`);
  createWorkspace = (data: { name: string; description?: string; user_ids?: number[] }) => this.request<{ workspace: WorkspaceDetail }>('/api/v1/workspaces', { method: 'POST', body: JSON.stringify(data) });
  updateWorkspace = (id: number, data: { name?: string; description?: string; status?: 'active' | 'archived' }) => this.request<{ workspace: WorkspaceDetail }>(`/api/v1/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  addWorkspaceMembers = (id: number, userIds: number[]) => this.request<{ workspace: WorkspaceDetail }>(`/api/v1/workspaces/${id}/memberships`, { method: 'POST', body: JSON.stringify({ user_ids: userIds }) });
  removeWorkspaceMember = (id: number, userId: number) => this.request<{ workspace: WorkspaceDetail }>(`/api/v1/workspaces/${id}/memberships/${userId}`, { method: 'DELETE' });
  users = () => this.request<{ users: UserSummary[] }>('/api/v1/users');
  channels = () => this.request<{ channels: ChannelSummary[] }>('/api/v1/channels');
  createChannel = (data: { workspace_id: number; name: string; description?: string; visibility?: 'cohort' | 'staff_only' }) => this.request<{ channel: ChannelSummary }>('/api/v1/channels', { method: 'POST', body: JSON.stringify(data) });
  updateChannel = (id: number, data: { name?: string; description?: string; visibility?: 'cohort' | 'staff_only'; status?: 'active' | 'archived' }) => this.request<{ channel: ChannelSummary }>(`/api/v1/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  archiveChannel = (id: number) => this.request<{ channel: ChannelSummary }>(`/api/v1/channels/${id}`, { method: 'DELETE' });
  directConversations = () => this.request<{ direct_conversations: DirectConversationSummary[] }>('/api/v1/direct_conversations');
  announcements = (params: { scope?: 'manage'; page?: number; per_page?: number; audience?: Announcement['audience']; status?: Announcement['status']; cohort_id?: number; read?: 'read' | 'unread'; sort?: string } = {}) => this.request<{ announcements: Announcement[]; unread_count: number; meta: PaginationMeta }>(`/api/v1/announcements${queryString(params)}`);
  announcement = (id: number) => this.request<{ announcement: Announcement }>(`/api/v1/announcements/${id}`);
  createAnnouncement = (data: { title: string; body: string; audience: Announcement['audience']; cohort_id?: number | null; status?: Announcement['status']; pinned?: boolean; send_push?: boolean }) => this.request<{ announcement: Announcement }>('/api/v1/announcements', { method: 'POST', body: JSON.stringify(data) });
  updateAnnouncement = (id: number, data: Partial<Pick<Announcement, 'title' | 'body' | 'audience' | 'cohort_id' | 'status' | 'pinned'>> & { send_push?: boolean }) => this.request<{ announcement: Announcement }>(`/api/v1/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  archiveAnnouncement = (id: number) => this.request<{ announcement: Announcement }>(`/api/v1/announcements/${id}`, { method: 'DELETE' });
  markAnnouncementsRead = () => this.request<{ unread_count: number }>('/api/v1/notifications/mark_all_read?notification_type=announcement', { method: 'PATCH' });
  notifications = (params: { page?: number; per_page?: number; notification_type?: string; read?: 'read' | 'unread'; sort?: string } = {}) => this.request<{ notifications: AppNotification[]; unread_count: number; meta: PaginationMeta }>(`/api/v1/notifications${queryString(params)}`);
  markNotificationRead = (id: number) => this.request<{ notification: AppNotification; unread_count: number }>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
  markAllNotificationsRead = (notificationType?: string) => this.request<{ unread_count: number }>(`/api/v1/notifications/mark_all_read${queryString({ notification_type: notificationType })}`, { method: 'PATCH' });
  pushConfig = () => this.request<PushConfig>('/api/v1/push_subscriptions/config');
  updateGlobalNotifications = (enabled: boolean) => this.request<PushConfig>('/api/v1/push_subscriptions/preferences', { method: 'PATCH', body: JSON.stringify({ notifications_enabled: enabled }) });
  channel = (id: number, options: ConversationOptions = { message_limit: 100 }) => this.request<{ channel: ChannelSummary } & ConversationPayload>(`/api/v1/channels/${id}${queryString(options)}`);
  directConversation = (id: number, options: ConversationOptions = { message_limit: 100 }) => this.request<{ direct_conversation: DirectConversationSummary } & ConversationPayload>(`/api/v1/direct_conversations/${id}${queryString(options)}`);
  markRead = (kind: 'channel' | 'dm', id: number) => this.request(kind === 'channel' ? `/api/v1/channels/${id}/read` : `/api/v1/direct_conversations/${id}/read`, { method: 'PATCH' });
  sendMessage = (kind: 'channel' | 'dm', id: number, input: string | MessageInput) => this.request<{ message: Message }>(kind === 'channel' ? `/api/v1/channels/${id}/messages` : `/api/v1/direct_conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(typeof input === 'string' ? { body: input, send_push: true } : input) });
  updateMessage = (id: number, body: string, mentionUserIds: number[] = []) => this.request<{ message: Message }>(`/api/v1/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ body, mention_user_ids: mentionUserIds }) });
  messageThread = (id: number) => this.request<{ root_message: Message; replies: Message[] }>(`/api/v1/messages/${id}/thread`);
  deleteMessage = (id: number) => this.request<{ message: Message }>(`/api/v1/messages/${id}`, { method: 'DELETE' });
  pinMessage = (id: number, remove = false) => this.request<{ message: Message }>(`/api/v1/messages/${id}/pin`, { method: remove ? 'DELETE' : 'PATCH' });
  react = (id: number, emoji: string, remove = false) => this.request<{ message: Message }>(`/api/v1/messages/${id}/reactions`, { method: remove ? 'DELETE' : 'POST', body: JSON.stringify({ emoji }) });
  updatePreference = (kind: 'channel' | 'dm', id: number, muted: boolean) => this.request('/api/v1/message_preferences', { method: 'PATCH', body: JSON.stringify({ target_type: kind === 'channel' ? 'Channel' : 'DirectConversation', target_id: id, muted }) });
  presignAttachment = (kind: 'channel' | 'dm', id: number, filename: string, contentType: string) => this.request<{ upload_url: string; fields: Record<string, string>; s3_key: string; max_size: number }>('/api/v1/message_attachments/presign', { method: 'POST', body: JSON.stringify({ ...(kind === 'channel' ? { channel_id: id } : { direct_conversation_id: id }), filename, content_type: contentType }) });
  availableUsers = (workspaceId: number) => this.request<{ users: UserSummary[] }>(`/api/v1/direct_conversations/available_users?workspace_id=${workspaceId}`);
  createDm = (workspaceId: number, userIds: number[]) => this.request<{ direct_conversation: DirectConversationSummary }>('/api/v1/direct_conversations', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, user_ids: userIds }) });
  cableToken = () => this.request<{ token: string; expires_in: number }>('/api/v1/cable_token', { method: 'POST' });
  registerDevice = (token: string, platform: string, deviceId: string | null, appVersion: string | null) => this.request('/api/v1/mobile_push_tokens', { method: 'POST', body: JSON.stringify({ token, platform, device_id: deviceId, app_version: appVersion }) });
  unregisterDevice = (token: string) => this.request(`/api/v1/mobile_push_tokens?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
  search = (query: string) => this.request<{ results: MessageSearchResult[] }>(`/api/v1/messages/search?q=${encodeURIComponent(query)}&limit=30`);
}

export function websocketUrl(token: string) {
  const base = API_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${base}/cable?token=${encodeURIComponent(token)}`;
}

export function websocketOrigin() { return API_URL; }

export type { MessageEvent };

import type {
  Announcement,
  AppNotification,
  ChannelSummary,
  ConversationPayload,
  DirectConversationSummary,
  FeedbackSnippet,
  Message,
  MessageEvent,
  MessageSearchResult,
  MobilePushConfig,
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
  StaffVideoProgress,
  StudentProgressDetail,
  StudentDashboard,
  Submission,
  SubmissionInput,
  UploadAttachmentInput,
  UserSummary,
  VideoProgressInput,
  WatchProgress,
  WorkspaceDetail,
  WorkspaceSummary,
  WeeklyPlan,
  HelpCategory,
  HelpContextSource,
  HelpContextType,
  HelpRequest,
  HelpUrgency,
  SupportQueue,
  Intervention,
  InterventionOutcome,
  InterventionStatus,
  CommunityPolicy,
  ContentReport,
  DataDeletionRequest,
} from './types';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import type { VoiceSurface } from './analytics';

export type TokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null>;

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
}

type MessageInput = {
  body: string;
  parent_message_id?: number | null;
  client_message_id?: string;
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

  async transcribeVoice(uri: string, surface: VoiceSurface = 'message', signal?: AbortSignal, attempt = 0): Promise<{ raw_text: string; suggested_text: string; duration_seconds: number; warnings: string[] }> {
    const controller = new AbortController();
    // Five-minute recordings need more processing time than the old 90-second drafts.
    const timeout = setTimeout(() => controller.abort(), 150_000);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      const token = await this.getToken({ skipCache: attempt > 0 });
      const form = new FormData();
      form.append('audio', new File(uri));
      form.append('surface', surface);
      form.append('cleanup', 'conservative');
      const response = await expoFetch(`${API_URL}/api/v1/transcriptions`, {
        method: 'POST', body: form, signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; errors?: string[]; code?: string };
        if (attempt === 0 && response.status === 401) return this.transcribeVoice(uri, surface, signal, attempt + 1);
        throw new ApiError(payload.error || payload.errors?.join(', ') || `Request failed (${response.status})`, response.status, payload.code);
      }
      return response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as Error).name === 'AbortError' && signal?.aborted) throw error;
      if ((error as Error).name === 'AbortError') throw new ApiError('Transcription timed out. Your recording is still available to retry.');
      throw new ApiError('Could not reach Code School. Your recording is still available to retry.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  session = () => this.request<{ user: SessionUser }>('/api/v1/sessions', { method: 'POST' });
  communityPolicy = () => this.request<{ community_policy: CommunityPolicy }>('/api/v1/community_policy');
  acceptCommunityPolicy = (version: string) => this.request<{ community_policy: CommunityPolicy }>('/api/v1/community_policy/accept', { method: 'POST', body: JSON.stringify({ version, accepted: true }) });
  reportContent = (input: { message_id?: number; reported_user_id?: number; reason: ContentReport['reason']; details?: string }) => this.request<{ content_report: ContentReport }>('/api/v1/content_reports', { method: 'POST', body: JSON.stringify({ content_report: input }) });
  blockUser = (blockedUserId: number) => this.request<{ blocked_user: { id: number; full_name: string; blocked_at: string } }>('/api/v1/user_blocks', { method: 'POST', body: JSON.stringify({ blocked_user_id: blockedUserId }) });
  blockedUsers = () => this.request<{ blocked_users: import('./types').BlockedUser[] }>('/api/v1/user_blocks');
  unblockUser = (blockedUserId: number) => this.request<void>(`/api/v1/user_blocks/${blockedUserId}`, { method: 'DELETE' });
  requestDataDeletion = () => this.request<{ data_deletion_request: DataDeletionRequest }>('/api/v1/data_deletion_requests', { method: 'POST' });
  dashboard = (signal?: AbortSignal) => this.request<{ dashboard: StudentDashboard | StaffDashboard }>('/api/v1/dashboard', { signal });
  weeklyPlan = (signal?: AbortSignal) => this.request<{ weekly_plan: WeeklyPlan }>('/api/v1/weekly_plan', { signal });
  profile = (signal?: AbortSignal) => this.request<ProfilePayload>('/api/v1/profile', { signal });
  updateProfile = (data: { github_username?: string | null }) => this.request<{ user: ProfilePayload['user'] }>('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(data) });
  webHandoff = (destination: string) => this.request<{ url: string }>('/api/v1/web_handoffs', { method: 'POST', body: JSON.stringify({ destination }) });
  resources = (signal?: AbortSignal) => this.request<{ resources: LearningResource[] }>('/api/v1/resources', { signal });
  lesson = (id: number, signal?: AbortSignal) => this.request<{ lesson: LessonDetail }>(`/api/v1/lessons/${id}`, { signal });
  helpRequests = (params: { cohort_id?: number; status?: string; context_type?: HelpContextType } = {}, signal?: AbortSignal) => this.request<{ help_requests: HelpRequest[] }>(`/api/v1/help_requests${queryString(params)}`, { signal });
  helpRequest = (id: number, signal?: AbortSignal) => this.request<{ help_request: HelpRequest }>(`/api/v1/help_requests/${id}`, { signal });
  createHelpRequest = (input: { cohort_id: number; context_type: HelpContextType; context_source?: HelpContextSource; context_id: number; category: HelpCategory; urgency: HelpUrgency; message: string }) => this.request<{ help_request: HelpRequest; created: boolean }>('/api/v1/help_requests', { method: 'POST', body: JSON.stringify({ help_request: input }) });
  updateHelpRequest = (id: number, input: { status: 'acknowledged' | 'resolved' | 'canceled'; staff_response?: string }) => this.request<{ help_request: HelpRequest; status_changed: boolean }>(`/api/v1/help_requests/${id}`, { method: 'PATCH', body: JSON.stringify({ help_request: input }) });
  supportQueue = (signal?: AbortSignal) => this.request<{ support_queue: SupportQueue }>('/api/v1/support_queue', { signal });
  intervention = (id: number, signal?: AbortSignal) => this.request<{ intervention: Intervention }>(`/api/v1/interventions/${id}`, { signal });
  updateIntervention = (id: number, input: { status?: InterventionStatus; action_summary?: string; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) => this.request<{ intervention: Intervention }>(`/api/v1/interventions/${id}`, { method: 'PATCH', body: JSON.stringify({ intervention: input }) });
  progress = (lessonId: number, signal?: AbortSignal) => this.request<{ progress: ProgressEntry[] }>(`/api/v1/progress?lesson_id=${lessonId}`, { signal });
  updateProgress = (contentBlockId: number, status: string) => this.request<{ progress: ProgressEntry }>('/api/v1/progress', { method: 'PATCH', body: JSON.stringify({ content_block_id: contentBlockId, status }) });
  createSubmission = (input: SubmissionInput) => this.request<{ submission: Submission }>('/api/v1/submissions', { method: 'POST', body: JSON.stringify(input) });
  updateSubmission = (id: number, input: Omit<SubmissionInput, 'content_block_id'>) => this.request<{ submission: Submission }>(`/api/v1/submissions/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  submissions = (params: { user_id?: number; ungraded?: boolean; module_id?: number } = {}, signal?: AbortSignal) => this.request<{ submissions: Submission[] }>(`/api/v1/submissions${queryString(params)}`, { signal });
  submission = (id: number, signal?: AbortSignal) => this.request<{ submission: Submission }>(`/api/v1/submissions/${id}`, { signal });
  gradeSubmission = (id: number, grade: 'A' | 'B' | 'C' | 'R', feedback: string, criterionResults?: { rubric_criterion_id: number; rating: import('./types').RubricRating; feedback?: string }[]) => this.request<{ submission: Submission }>(`/api/v1/submissions/${id}/grade`, { method: 'PATCH', body: JSON.stringify({ grade, feedback, criterion_results: criterionResults }) });
  feedbackSnippets = (signal?: AbortSignal) => this.request<{ feedback_snippets: FeedbackSnippet[] }>('/api/v1/feedback_snippets', { signal });
  createFeedbackSnippet = (body: string) => this.request<{ feedback_snippet: FeedbackSnippet }>('/api/v1/feedback_snippets', { method: 'POST', body: JSON.stringify({ feedback_snippet: { body } }) });
  useFeedbackSnippet = (id: number) => this.request<{ feedback_snippet: FeedbackSnippet }>(`/api/v1/feedback_snippets/${id}/use`, { method: 'POST' });
  attemptKnowledgeCheck = (id: number, selectedOption: number) => this.request<{ knowledge_check: import('./types').KnowledgeCheck; progress: { status: string; completed_at: string | null } | null }>(`/api/v1/knowledge_checks/${id}/attempts`, { method: 'POST', body: JSON.stringify({ selected_option: selectedOption }) });
  studentProgress = (studentId: number, cohortId?: number, signal?: AbortSignal) => this.request<StudentProgressDetail>(`/api/v1/progress/student/${studentId}${queryString({ cohort_id: cohortId })}`, { signal });
  restartEnrollment = (enrollmentId: number, confirmation: string, reason?: string) => this.request<{
    message: string;
    restart: { id: number; student_id: number; cohort_id: number; records_removed: Record<string, number>; created_at: string };
    recovery_plan: import('./types').RecoveryPlan;
  }>(`/api/v1/enrollments/${enrollmentId}/restart`, { method: 'POST', body: JSON.stringify({ confirmation, reason }) });
  studentRecordingProgress = (studentId: number, cohortId?: number, signal?: AbortSignal) => this.request<{ watch_progresses: StaffVideoProgress[] }>(`/api/v1/watch_progress/student/${studentId}${queryString({ cohort_id: cohortId })}`, { signal });
  studentLessonVideoProgress = (studentId: number, cohortId?: number, signal?: AbortSignal) => this.request<{ lesson_videos: StaffVideoProgress[] }>(`/api/v1/watch_progress/student/${studentId}/lesson_videos${queryString({ cohort_id: cohortId })}`, { signal });
  contentVideoStream = (id: number, signal?: AbortSignal) => this.request<{ stream_url: string; expires_at: string; video_progress: ContentVideoProgress | null }>(`/api/v1/content_blocks/${id}/video_stream`, { signal });
  updateContentVideoProgress = (id: number, input: VideoProgressInput) => this.request<{ video_progress: ContentVideoProgress & { content_block_id: number; completed: boolean } }>(`/api/v1/content_blocks/${id}/video_progress`, { method: 'PATCH', body: JSON.stringify(input) });
  recordings = (signal?: AbortSignal) => this.request<{ recordings: RecordingItem[]; s3_recordings: RecordingItem[]; items: RecordingItem[] }>('/api/v1/recordings', { signal });
  cohorts = (signal?: AbortSignal) => this.request<{ cohorts: { id: number; name: string; status: string; start_date: string }[] }>('/api/v1/cohorts', { signal });
  presignRecordingUpload = (cohortId: number, filename: string, contentType: string) => this.request<{ upload_url: string; fields: Record<string, string>; s3_key: string }>(`/api/v1/cohorts/${cohortId}/recordings_presign`, { method: 'POST', body: JSON.stringify({ filename, content_type: contentType }) });
  initiateMultipartUpload = (cohortId: number, filename: string, contentType: string, fileSize: number) => this.request<{ s3_key: string; upload_id: string }>('/api/v1/uploads/multipart/initiate', { method: 'POST', body: JSON.stringify({ cohort_id: cohortId, filename, content_type: contentType, file_size: fileSize }) });
  multipartPartUrl = (s3Key: string, uploadId: string, partNumber: number) => this.request<{ upload_url: string }>('/api/v1/uploads/multipart/part_url', { method: 'POST', body: JSON.stringify({ s3_key: s3Key, upload_id: uploadId, part_number: partNumber }) });
  completeMultipartUpload = (s3Key: string, uploadId: string, parts: { part_number: number; etag: string }[]) => this.request<void>('/api/v1/uploads/multipart/complete', { method: 'POST', body: JSON.stringify({ s3_key: s3Key, upload_id: uploadId, parts }) });
  abortMultipartUpload = (s3Key: string, uploadId: string) => this.request<void>('/api/v1/uploads/multipart/abort', { method: 'DELETE', body: JSON.stringify({ s3_key: s3Key, upload_id: uploadId }) });
  abandonUpload = (s3Key: string) => this.request<void>(`/api/v1/uploads/abandon?s3_key=${encodeURIComponent(s3Key)}`, { method: 'DELETE' });
  createRecording = (cohortId: number, input: { title: string; description?: string; recorded_date?: string; s3_key: string; content_type: string; file_size: number; publish_immediately?: boolean }) => this.request<{ recording: RecordingItem }>(`/api/v1/cohorts/${cohortId}/recordings`, { method: 'POST', body: JSON.stringify(input) });
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
  createCohortDm = (cohortId: number, userIds: number[]) => this.request<{ direct_conversation: DirectConversationSummary }>('/api/v1/direct_conversations', { method: 'POST', body: JSON.stringify({ cohort_id: cohortId, user_ids: userIds }) });
  cableToken = () => this.request<{ token: string; expires_in: number }>('/api/v1/cable_token', { method: 'POST' });
  registerDevice = (token: string, platform: string, deviceId: string | null, appVersion: string | null) => this.request('/api/v1/mobile_push_tokens', { method: 'POST', body: JSON.stringify({ token, platform, device_id: deviceId, app_version: appVersion }) });
  unregisterDevice = (token: string) => this.request(`/api/v1/mobile_push_tokens?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
  mobilePushConfig = () => this.request<MobilePushConfig>('/api/v1/mobile_push_tokens/config');
  updateMobilePushPreference = (enabled: boolean) => this.request<MobilePushConfig>('/api/v1/mobile_push_tokens/preferences', { method: 'PATCH', body: JSON.stringify({ notifications_enabled: enabled }) });
  search = (query: string) => this.request<{ results: MessageSearchResult[] }>(`/api/v1/messages/search?q=${encodeURIComponent(query)}&limit=30`);
}

export function websocketUrl(token: string) {
  const base = API_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${base}/cable?token=${encodeURIComponent(token)}`;
}

export function websocketOrigin() { return API_URL; }

export type { MessageEvent };

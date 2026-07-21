export type ConversationKind = 'channel' | 'dm';

export interface UserSummary {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_staff: boolean;
}

export interface SessionUser extends UserSummary {
  clerk_id: string;
  first_name: string;
  last_name: string;
  github_username: string | null;
}

export interface ProfilePayload {
  user: Pick<SessionUser, 'id' | 'email' | 'first_name' | 'last_name' | 'full_name' | 'github_username' | 'avatar_url'>;
  enrollments: {
    id: number;
    cohort_name: string;
    curriculum_name: string;
    status: string;
    enrolled_at: string | null;
  }[];
}

export interface WorkspaceSummary {
  id: number;
  name: string;
  slug: string;
  workspace_type: 'cohort' | 'community';
  status: 'active' | 'archived';
  cohort_id: number | null;
  cohort_name: string | null;
  description: string | null;
  member_count: number;
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember extends UserSummary {
  membership_role: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  members: WorkspaceMember[];
}

export interface LatestMessage {
  id: number;
  body: string;
  created_at: string;
  author_name: string;
}

export interface ChannelSummary {
  id: number;
  workspace_id: number;
  workspace_name: string;
  workspace_type: 'cohort' | 'community';
  cohort_id: number | null;
  cohort_name: string | null;
  name: string;
  description: string | null;
  visibility: 'cohort' | 'staff_only';
  status: 'active' | 'archived';
  position: number;
  muted: boolean;
  unread_count: number;
  last_read_at: string | null;
  latest_message: LatestMessage | null;
  created_at: string;
  updated_at: string;
}

export interface DirectConversationSummary {
  id: number;
  workspace_id: number;
  workspace_name: string;
  workspace_type: 'cohort' | 'community';
  cohort_id: number | null;
  cohort_name: string | null;
  title: string;
  status: 'active' | 'archived';
  muted: boolean;
  unread_count: number;
  last_read_at: string | null;
  latest_message: LatestMessage | null;
  users: UserSummary[];
  created_at: string;
  updated_at: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  reacted: boolean;
  users: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>[];
}

export interface Message {
  id: number;
  channel_id: number | null;
  direct_conversation_id: number | null;
  parent_message_id: number | null;
  body: string;
  mention_user_ids: number[];
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by_id?: number | null;
  created_at: string;
  updated_at: string;
  mine: boolean;
  reactions: MessageReaction[];
  attachments: { id: number; filename: string; content_type: string; byte_size: number; image: boolean; url?: string }[];
  read_receipts?: { count: number; users: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>[] };
  client_status?: 'sending' | 'failed';
  client_error?: string;
  client_uploads?: UploadAttachmentInput[];
  reply_count?: number;
  author: Pick<UserSummary, 'id' | 'full_name' | 'email' | 'role' | 'avatar_url'>;
}

export interface MessageWindowMeta {
  oldest_message_id: number | null;
  newest_message_id: number | null;
  has_older: boolean;
  has_newer: boolean;
}

export interface ConversationPayload {
  messages: Message[];
  pinned_messages: Message[];
  meta: MessageWindowMeta;
}

export interface UploadAttachmentInput {
  s3_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
}

export interface PendingAttachment {
  local_id: string;
  uri: string;
  filename: string;
  content_type: string;
  byte_size: number;
  image: boolean;
  status: 'queued' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  error?: string;
  uploaded?: UploadAttachmentInput;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string | null;
  audience: 'cohort' | 'global' | 'staff';
  status: 'draft' | 'published' | 'archived';
  cohort_name: string | null;
  cohort_id: number | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  author?: Pick<UserSummary, 'id' | 'full_name' | 'email'>;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

export interface AppNotification {
  id: number;
  notification_type: 'announcement' | 'message' | 'mention' | 'direct_message' | string;
  title: string;
  body: string;
  path: string;
  read_at: string | null;
  created_at: string;
  actor: Pick<UserSummary, 'id' | 'full_name' | 'email'> | null;
  notifiable: { type: string; id: number };
}

export interface PushConfig {
  configured?: boolean;
  public_key?: string | null;
  missing?: string[];
  notifications_enabled: boolean;
  active_subscription_count: number;
}

export interface MessageEvent {
  event: 'created' | 'updated' | 'deleted';
  channel_id: number | null;
  direct_conversation_id: number | null;
  message: Message;
  channel?: ChannelSummary | null;
  direct_conversation?: DirectConversationSummary | null;
}

export type MessageSearchResult = Message & {
  context: {
    type: 'channel' | 'direct_conversation';
    id: number;
    label: string;
    workspace_id: number;
  };
};

export interface SubmissionWindowStatus {
  week_number?: number;
  opens_at?: string | null;
  closes_at?: string | null;
  submissions_open?: boolean;
  submissions_closed?: boolean;
  status?: string;
}

export interface LearningResource {
  id: number;
  title: string;
  url: string;
  category: string;
  description: string | null;
}

export interface OfficeHourOccurrence {
  id?: number | string;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  start_time?: string;
  end_time?: string;
  meeting_url?: string | null;
  location?: string | null;
  description?: string | null;
}

export interface StudentDashboardLesson {
  id: number;
  title: string;
  lesson_type: string;
  release_day?: number;
  required?: boolean;
  available: boolean;
  unlock_date: string | null;
  completed: boolean;
  total_blocks: number;
  completed_blocks: number;
  submission_window?: SubmissionWindowStatus;
}

export interface StudentDashboardModule {
  id: number;
  name: string;
  module_type: string;
  position?: number;
  progress_percentage: number;
  completed_blocks: number;
  total_blocks: number;
  assigned: boolean;
  unlocked: boolean;
  available: boolean;
  unlock_date: string | null;
  lessons: StudentDashboardLesson[];
}

export interface StudentDashboard {
  enrolled: boolean;
  user: { id: number; full_name: string; role: string };
  cohort?: {
    id: number;
    name: string;
    start_date: string;
    status: string;
    announcements?: Announcement[];
    unread_notifications_count?: number;
  };
  overall_progress?: { completed: number; total: number; percentage: number };
  modules?: StudentDashboardModule[];
  continue_lesson?: { id: number; title: string } | null;
  action_items?: {
    type: string;
    submission_id: number;
    lesson_id: number;
    lesson_title: string;
    content_block_title: string;
    feedback: string | null;
    submission_window?: SubmissionWindowStatus;
    submissions_closed?: boolean;
  }[];
  recently_graded?: {
    submission_id: number;
    lesson_id: number;
    lesson_title: string;
    content_block_title: string;
    grade: string;
    feedback: string | null;
    graded_at: string | null;
  }[];
  resources?: LearningResource[];
  office_hours?: OfficeHourOccurrence[];
}

export interface StaffDashboard {
  user: { id: number; full_name: string; role: string };
  cohorts: {
    cohort: { id: number; name: string; status: string; active_count?: number; enrolled_count?: number };
    ungraded_count: number;
    students: unknown[];
  }[];
}

export interface ProgressEntry {
  id: number;
  content_block_id: number;
  status: 'not_started' | 'in_progress' | 'completed' | string;
  completed_at: string | null;
}

export interface SubmissionBrief {
  id: number;
  submission_type?: string | null;
  text: string | null;
  grade: string | null;
  feedback: string | null;
  graded_at: string | null;
  github_issue_url?: string | null;
  github_code_url?: string | null;
  repo_url?: string | null;
  pr_url?: string | null;
  live_url?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  notes?: string | null;
  num_submissions: number;
  created_at: string;
}

export interface LessonContentBlock {
  id: number;
  block_type: 'video' | 'text' | 'exercise' | 'code_challenge' | 'checkpoint' | 'recording' | string;
  position: number;
  title: string | null;
  body: string | null;
  video_url: string | null;
  s3_video_key?: string | null;
  has_s3_video?: boolean;
  completion_required?: boolean;
  filename: string | null;
  submission_type?: string | null;
  submission_type_explicit?: string | null;
  submission_config?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  progress?: { status: string; completed_at: string | null; video_last_position?: number; video_total_watched?: number };
  submissions?: SubmissionBrief[];
}

export interface LessonDetail {
  id: number;
  module_id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
  requires_submission: boolean;
  requires_github?: boolean;
  repository_name?: string | null;
  submission_type?: string;
  content_blocks_count: number;
  submission_window?: SubmissionWindowStatus;
  content_blocks: LessonContentBlock[];
  prev_lesson: { id: number; title: string } | null;
  next_lesson: { id: number; title: string } | null;
}

export interface Submission {
  id: number;
  content_block_id: number;
  user_id: number;
  user_name: string;
  submission_type?: string | null;
  text: string | null;
  grade: string | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  github_issue_url: string | null;
  github_code_url: string | null;
  repo_url?: string | null;
  pr_url?: string | null;
  live_url?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  notes?: string | null;
  num_submissions: number;
  created_at: string;
  content_block_title: string;
  content_block_type: string;
  lesson_title: string;
  filename: string | null;
  submission_config?: Record<string, unknown>;
  language_hint: string | null;
}

export interface SubmissionInput {
  content_block_id: number;
  text?: string;
  repo_url?: string;
  pr_url?: string;
  live_url?: string;
  branch?: string;
  commit_sha?: string;
  notes?: string;
}

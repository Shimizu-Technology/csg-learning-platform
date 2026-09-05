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
  community_policy?: CommunityPolicy | null;
}

export interface CommunityPolicy {
  version: string;
  accepted: boolean;
  accepted_at: string | null;
  privacy_url: string;
  terms_url: string;
  deletion_url: string;
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
  client_message_id?: string | null;
  body: string;
  mention_user_ids: number[];
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by_id?: number | null;
  created_at: string;
  updated_at: string;
  mine: boolean;
  blocked?: boolean;
  reactions: MessageReaction[];
  attachments: { id: number; filename: string; content_type: string; byte_size: number; image: boolean; url?: string }[];
  read_receipts?: { count: number; users: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>[] };
  client_status?: 'sending' | 'failed';
  client_error?: string;
  client_uploads?: UploadAttachmentInput[];
  reply_count?: number;
  author: Pick<UserSummary, 'id' | 'full_name' | 'email' | 'role' | 'avatar_url'>;
}

export interface ContentReport {
  id: number;
  reason: 'harassment' | 'spam' | 'inappropriate_content' | 'safety_concern' | 'other';
  status: 'pending' | 'reviewing' | 'actioned' | 'dismissed';
  created_at: string;
}

export interface DataDeletionRequest {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'declined';
  created_at: string;
}

export interface BlockedUser {
  id: number;
  full_name: string;
  avatar_url: string | null;
  blocked_at: string;
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
  id: number | string;
  title: string;
  url: string;
  category: string;
  description: string | null;
  cohort_id?: number;
  cohort_name?: string;
}

export interface WatchProgress {
  recording_id?: number;
  last_position_seconds: number;
  total_watched_seconds: number;
  progress_percentage: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface RecordingItem {
  id: number | string;
  item_key: string;
  cohort_id: number;
  cohort_name: string;
  title: string;
  description: string | null;
  recorded_date: string | null;
  date?: string | null;
  url?: string | null;
  source: 'uploaded' | 'youtube' | 'external';
  status?: 'draft' | 'published';
  duration_seconds?: number | null;
  duration_display?: string | null;
  file_size_display?: string | null;
  created_at?: string;
  watch_progress?: WatchProgress | null;
}

export type HelpContextType = 'lesson' | 'exercise' | 'recording';
export type HelpContextSource = 'primary' | 'legacy';
export type HelpCategory = 'concept' | 'technical' | 'instructions' | 'feedback' | 'other';
export type HelpUrgency = 'normal' | 'urgent';
export type HelpRequestStatus = 'open' | 'acknowledged' | 'resolved' | 'canceled';

export interface HelpRequest {
  id: number;
  cohort: { id: number; name: string };
  context_type: HelpContextType;
  context_source: HelpContextSource;
  context_id: number;
  context_label: string;
  context_path: string;
  category: HelpCategory;
  urgency: HelpUrgency;
  status: HelpRequestStatus;
  message: string;
  staff_response: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  owner: { id: number; full_name: string } | null;
  student?: { id: number; full_name: string; email: string };
}

export interface SupportQueueStudent {
  enrollment_id: number;
  user_id: number;
  cohort_id: number;
  full_name: string;
  email: string;
  cohort_name: string;
  progress_percentage: number;
  completed_blocks: number;
  total_blocks: number;
  last_activity_at: string | null;
  help_request_count: number;
  urgent_help_count: number;
  redo_count: number;
  ungraded_count: number;
  inactive: boolean;
  active_intervention_id: number | null;
  intervention_status: InterventionStatus | null;
  follow_up_due: boolean;
  recovery_plan_id: number | null;
  recovery_check_in_due: boolean;
  priority: number;
}

export type InterventionTrigger = 'manual' | 'help_request' | 'redo' | 'ungraded' | 'inactivity' | 'restart' | 'extended_absence';
export type InterventionSeverity = 'normal' | 'urgent';
export type InterventionStatus = 'open' | 'contacted' | 'waiting_on_student' | 'monitoring' | 'resolved' | 'canceled';
export type InterventionOutcome = 're_engaged' | 'plan_completed' | 'support_resolved' | 'referred' | 'paused' | 'withdrawn' | 'no_change';

export interface InterventionNote {
  id: number;
  body: string;
  author: { id: number; full_name: string };
  created_at: string;
  updated_at: string;
}

export interface Intervention {
  id: number;
  trigger_type: InterventionTrigger;
  severity: InterventionSeverity;
  status: InterventionStatus;
  evidence_snapshot: Record<string, unknown>;
  action_summary: string | null;
  next_follow_up_at: string | null;
  follow_up_due: boolean;
  outcome: InterventionOutcome | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  enrollment: { id: number; status: string; student: { id: number; full_name: string; email: string }; cohort: { id: number; name: string } };
  owner: { id: number; full_name: string };
  created_by: { id: number; full_name: string };
  help_request_id: number | null;
  recovery_plan_id: number | null;
  notes?: InterventionNote[];
}

export interface RecoveryPlan {
  id: number;
  source: 'restart' | 'extended_absence' | 'manual';
  status: 'active' | 'completed' | 'canceled';
  target_pace: string;
  required_scope: string;
  optional_scope: string | null;
  check_in_cadence: string;
  next_check_in_at: string;
  last_check_in_at: string | null;
  check_in_due: boolean;
  outcome: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  enrollment: Intervention['enrollment'];
  owner: { id: number; full_name: string };
  created_by: { id: number; full_name: string };
  enrollment_restart_id: number | null;
  intervention_id: number | null;
}

export interface SupportQueue {
  generated_at: string;
  summary: { open_help_count: number; acknowledged_help_count: number; urgent_help_count: number; student_count: number; active_intervention_count: number; due_follow_up_count: number; active_recovery_plan_count: number; due_recovery_check_in_count: number };
  help_requests: HelpRequest[];
  recently_resolved: HelpRequest[];
  students: SupportQueueStudent[];
  interventions: Intervention[];
  recovery_plans: RecoveryPlan[];
}

export interface VideoProgressInput {
  last_position_seconds: number;
  total_watched_seconds: number;
  duration_seconds: number;
}

export interface ContentVideoProgress {
  last_position: number;
  total_watched: number;
  duration: number | null;
  status: string;
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
  event_kind?: 'office_hours' | 'live_class';
}

export interface WeeklyPlanLessonItem {
  id: string;
  kind: 'lesson';
  lesson_id: number;
  module_id: number;
  title: string;
  module_title: string;
  lesson_type: string;
  required: boolean;
  scheduled_for: string;
  carried_forward: boolean;
  state: 'completed' | 'open' | 'upcoming' | 'closed';
  submission_close_at: string | null;
  submissions_closed: boolean;
}

export interface WeeklyPlan {
  enrolled: boolean;
  cohort?: { id: number; name: string };
  week_number?: number;
  starts_on?: string;
  ends_on?: string;
  timezone: string;
  generated_at?: string;
  summary?: { required_count: number; required_completed_count: number; open_redo_count: number; optional_count: number };
  required?: WeeklyPlanLessonItem[];
  optional?: WeeklyPlanLessonItem[];
  redos?: { id: string; kind: 'redo'; submission_id: number; lesson_id: number; title: string; lesson_title: string; feedback: string | null; state: 'open' | 'closed'; submission_close_at: string | null }[];
  events?: { id: string; kind: 'office_hours' | 'live_class'; office_hour_id: number; title: string; description: string | null; starts_at: string; ends_at: string; meeting_url: string; timezone: string; recurrence: 'once' | 'weekly'; event_kind: 'office_hours' | 'live_class' }[];
  upcoming_unlocks?: { id: string; kind: 'unlock'; lesson_id: number; module_id: number; title: string; module_title: string; unlocks_on: string; required: boolean }[];
  recording_catch_up?: { id: string; kind: 'recording'; recording_id: number; title: string; recorded_on: string | null; progress_percentage: number }[];
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
  cohorts: StaffCohortDashboard[];
}

export interface StaffStudentSummary {
  user_id: number;
  full_name: string;
  email: string;
  github_username: string | null;
  progress_percentage: number;
  completed_blocks: number;
  total_blocks: number;
  last_sign_in_at: string | null;
  last_seen_at: string | null;
  last_activity_at: string | null;
  blocks_this_week: number;
  submissions_this_week: number;
  ungraded_count: number;
  redo_count: number;
  enrollment_status: string;
}

export interface StaffCohortDashboard {
    cohort: { id: number; name: string; start_date?: string; status: string; active_count?: number; enrolled_count?: number };
    ungraded_count: number;
    students: StaffStudentSummary[];
}

export interface StudentProgressDetail {
  enrollment: { id: number; status: string };
  user: { id: number; full_name: string; email: string; github_username: string | null; avatar_url: string | null; last_sign_in_at: string | null; last_seen_at: string | null };
  cohort: { id: number; name: string; start_date: string; status: string };
  learning_evidence_scope?: { kind: 'curriculum'; curriculum_id: number; curriculum_name: string; enrollment_count: number; shared_across_enrollments: boolean };
  overall_progress: { completed: number; total: number; percentage: number };
  modules: StaffProgressModule[];
  recent_activity: { content_block_id: number; block_title: string | null; block_type: string; completed_at: string | null }[];
}

export interface StaffProgressModule {
  id: number;
  name: string;
  module_type: string;
  position: number;
  total_blocks: number;
  completed_blocks: number;
  progress_percentage: number;
  lessons: {
    id: number;
    title: string;
    lesson_type: string;
    available: boolean;
    total_blocks: number;
    completed_blocks: number;
    completed: boolean;
    blocks: { id: number; title: string | null; block_type: string; status: string; completed_at: string | null; submission: { id: number; grade: string | null; feedback: string | null; submitted_at: string; graded_at: string | null } | null }[];
  }[];
}

export interface StaffVideoProgress {
  recording_id?: number;
  content_block_id?: number;
  recording_title?: string;
  title?: string;
  lesson_title?: string;
  module_title?: string;
  cohort_id: number;
  cohort_name: string;
  duration_seconds: number | null;
  last_position_seconds: number;
  total_watched_seconds: number;
  progress_percentage: number;
  completed: boolean;
  last_watched_at?: string | null;
  completed_at?: string | null;
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
  updated_at?: string;
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
  objective_ids?: number[];
  rubric?: Rubric | null;
  knowledge_check?: KnowledgeCheck | null;
  progress?: { status: string; completed_at: string | null; video_last_position?: number; video_total_watched?: number };
  submissions?: SubmissionBrief[];
}

export type RubricRating = 'exceeds' | 'meets' | 'developing' | 'redo';

export interface RubricCriterion {
  id: number;
  title: string;
  description: string;
  objective_code?: string | null;
  rating?: RubricRating | null;
  feedback?: string | null;
}

export interface Rubric {
  id: number;
  title: string;
  description: string | null;
  criteria: RubricCriterion[];
}

export interface FeedbackSnippet {
  id: number;
  title: string;
  body: string;
  usage_count: number;
  created_by: string;
  can_manage: boolean;
}

export interface KnowledgeCheckAttempt {
  id: number;
  selected_option: number;
  correct: boolean;
  correct_option: number;
  explanation: string;
  created_at: string;
}

export interface KnowledgeCheck {
  id: number;
  prompt: string;
  options: string[];
  objective_code?: string | null;
  learning_objective_id?: number | null;
  attempt_count: number;
  latest_attempt: KnowledgeCheckAttempt | null;
  correct_option?: number;
  explanation?: string;
}

export interface LessonObjective {
  alignment_id: number;
  id: number;
  code: string;
  title: string;
  description: string | null;
  success_criteria: string;
  active: boolean;
  content_block_id: number | null;
  content_block_title: string | null;
}

export interface LessonDetail {
  id: number;
  curriculum_id?: number;
  cohort_id?: number;
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
  objectives?: LessonObjective[];
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
  updated_at?: string;
  content_block_title: string;
  content_block_type: string;
  lesson_id?: number;
  lesson_title: string;
  module_id?: number;
  module_name?: string;
  filename: string | null;
  submission_config?: Record<string, unknown>;
  language_hint: string | null;
  solution?: string | null;
  exercise_body?: string | null;
  exercise_video_url?: string | null;
  rubric?: Rubric | null;
  github_checks?: GithubChecks;
}

export interface GithubCheckRun {
  id: number;
  external_id: number;
  name: string;
  workflow_name: string | null;
  app_slug: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  fetched_at: string;
}

export interface GithubChecks {
  head_sha: string | null;
  fetched_at: string | null;
  summary: { total: number; passed: number; failed: number; pending: number; neutral: number };
  runs: GithubCheckRun[];
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

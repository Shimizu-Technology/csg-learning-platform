import type { components } from './api.generated';

export type ConversationKind = 'channel' | 'dm';

export interface UserSummary {
  cohort_name?: string | null;
  id: number;
  full_name: string;
  email?: string;
  role: string;
  avatar_url: string | null;
  /** Optional @handle the person set in Profile, to tell same-name people apart (M-13). */
  handle?: string | null;
  is_admin: boolean;
  is_staff: boolean;
}

export interface SessionUser extends UserSummary {
  email: string;
  clerk_id: string;
  first_name: string;
  last_name: string;
  github_username: string | null;
  community_policy?: CommunityPolicy | null;
}

export interface SessionEnrollment {
  id: number;
  cohort: {
    id: number;
    name: string;
    cohort_type: string;
    start_date: string;
    status: string;
  };
  status: string;
  enrolled_at: string | null;
  access_expires_at?: string | null;
}

export interface AccessibleCohort {
  features?: Record<string, boolean>;
  id: number;
  name: string;
  status: string;
  cohort_type: string;
  curriculum_name: string;
  workspace_id: number | null;
  enrollment_status: string | null;
}

export interface CohortHome {
  attention?: StaffAttention;
  cohort: Pick<AccessibleCohort, 'id' | 'name' | 'status' | 'cohort_type' | 'curriculum_name' | 'workspace_id'> & { start_date: string; end_date: string | null };
  permissions: { can_manage_roster: boolean; can_manage_schedule: boolean; can_manage_learning_schedule: boolean; can_grade: boolean; can_announce: boolean };
  counts?: { invited: number; joined: number; active_students: number; ungraded: number; redos: number; open_help: number };
  students?: { user_id: number; enrollment_id: number; full_name: string; email: string; status: string; invited_at: string | null; joined_at: string | null; invite_delivery_status: string; progress_percentage: number; ungraded_count: number; redo_count: number; last_seen_at: string | null }[];
  upcoming_events: { office_hour_id: number; title: string; starts_at: string; ends_at: string; timezone: string; event_kind: string; meeting_url?: string | null }[];
  recent_announcements: { id: number; title: string; published_at: string | null; pinned: boolean }[];
  own_progress_percentage?: number;
}

export interface CohortOfficeHour {
  id: number;
  cohort_id: number;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  meeting_url: string;
  timezone: string;
  recurrence: 'once' | 'weekly';
  event_kind: 'office_hours' | 'live_class';
  active: boolean;
  occurrences: CohortHome['upcoming_events'];
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
  last_read_message_id?: number | null;
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
  last_read_message_id?: number | null;
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
  client_pending_attachments?: PendingAttachment[];
  client_upload_progress?: number;
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
  unread?: boolean;
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

export type PaginationMeta = components['schemas']['PaginationMeta'];

export type AppNotification = components['schemas']['NotificationEntry'];

export interface PushConfig {
  configured?: boolean;
  public_key?: string | null;
  missing?: string[];
  notifications_enabled: boolean;
  active_subscription_count: number;
}

export interface MobilePushConfig {
  notifications_enabled: boolean;
  active_device_count: number;
}

export interface MessageEvent {
  event: 'created' | 'updated' | 'deleted';
  channel_id: number | null;
  direct_conversation_id: number | null;
  message: Message;
  channel?: ChannelSummary | null;
  direct_conversation?: DirectConversationSummary | null;
}

export interface MessageTypingEvent {
  event: 'typing';
  channel_id: number | null;
  direct_conversation_id: number | null;
  thread_root_id: number | null;
  active: boolean;
  user: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>;
}

export type RealtimeMessageEvent = MessageEvent | MessageTypingEvent;

export type MessageSearchResult = Message & {
  context: {
    type: 'channel' | 'direct_conversation';
    id: number;
    label: string;
    workspace_id: number;
  };
};

export type SubmissionWindowStatus = components['schemas']['SubmissionWindowStatus'];

export interface LearningResource {
  download_id?: number;
  curriculum_id?: number;
  filename?: string;
  file_size?: number;
  id: number | string;
  title: string;
  url: string;
  category: string;
  description: string | null;
  cohort_id?: number;
  cohort_name?: string;
}

export type WatchProgress = components['schemas']['S3RecordingWatchProgress'];

export type RecordingItem = components['schemas']['RecordingItem'];

export type HelpContextType = components['schemas']['HelpContextType'];
export type HelpContextSource = components['schemas']['HelpContextSource'];
export type HelpCategory = components['schemas']['HelpCategory'];
export type HelpUrgency = components['schemas']['HelpUrgency'];
export type HelpRequestStatus = components['schemas']['HelpRequestStatus'];

export type HelpRequest = components['schemas']['HelpRequest'];

export interface AttentionAction {
  label: string;
  web_path: string;
  native_path: string;
  web_handoff?: boolean;
  enrollment_id: number;
}

export interface AttentionReason {
  code: string;
  label: string;
  source_type: string;
  source_ids: number[];
  since: string | null;
  action: AttentionAction;
}

export interface StaffAttention {
  generated_at: string;
  students: SupportQueueStudent[];
  summary: { student_count: number; checked_enrollment_count: number; ungraded_count: number; redo_count: number; reason_counts: Record<string, number> };
}

export interface SupportQueueStudent {
  needs_attention?: boolean;
  reasons?: AttentionReason[];
  next_action?: AttentionAction | null;
  released_blocks?: number;
  released_unfinished_blocks?: number;
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
  owner_valid: boolean;
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

export type VideoProgressInput = components['schemas']['VideoProgressInput'] & { duration_seconds: number };

export type ContentVideoProgress = components['schemas']['VideoProgressEntry'];

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
  /** Additive: what happened to reviewed work in this lesson. */
  review_status?: 'awaiting_review' | 'redo_requested' | 'reviewed' | null;
  submission_close_at: string | null;
  submissions_closed: boolean;
}

export type EnrollmentCapabilities = components['schemas']['LearnerCapabilities'];

export interface PersonalPlanLesson {
  lesson_id: number;
  module_id: number;
  title: string;
  required: boolean;
  available: boolean;
  completed: boolean;
  review_status?: 'awaiting_review' | 'redo_requested' | 'reviewed' | null;
}
export interface PersonalLearningPlan {
  submission_deadlines?: Array<{ lesson_id: number; title: string; available: boolean; closes_at: string | null; closed: boolean }>;
  title: string;
  description: string | null;
  target_date: string | null;
  next_check_in_on: string | null;
  updated_at: string;
  required_count: number;
  completed_count: number;
  awaiting_review_count: number;
  milestones: Array<{ title: string; due_on: string; required_count: number; completed_count: number; lessons: PersonalPlanLesson[] }>;
  next_lesson: PersonalPlanLesson | null;
  requirement_changes: Array<{ lesson_id: number; title: string; required: boolean; reason: string }>;
}

export interface WeeklyPlan {
  personal_plan?: PersonalLearningPlan | null;
  enrolled: boolean;
  mode?: 'weekly' | 'library';
  plan_kind?: 'self_paced';
  capabilities?: EnrollmentCapabilities;
  course_overview?: {
    course_name: string;
    next_lesson: { lesson_id: number; title: string; module_id: number } | null;
  };
  cohort?: { id: number; name: string };
  week_number?: number;
  starts_on?: string;
  ends_on?: string;
  timezone: string;
  generated_at?: string;
  summary?: { required_count: number; required_completed_count: number; open_redo_count: number; optional_count: number };
  library_summary?: { module_count: number; lesson_count: number; recording_count: number };
  required?: WeeklyPlanLessonItem[];
  optional?: WeeklyPlanLessonItem[];
  redos?: { id: string; kind: 'redo'; submission_id: number; content_block_id?: number; lesson_id: number; title: string; lesson_title: string; feedback: string | null; state: 'open' | 'closed'; submission_close_at: string | null }[];
  events?: { id: string; kind: 'office_hours' | 'live_class'; office_hour_id: number; title: string; description: string | null; starts_at: string; ends_at: string; meeting_url: string; timezone: string; recurrence: 'once' | 'weekly'; event_kind: 'office_hours' | 'live_class' }[];
  upcoming_unlocks?: { id: string; kind: 'unlock'; lesson_id: number; module_id: number; title: string; module_title: string; unlocks_on: string; required: boolean }[];
  recording_catch_up?: { id: string; kind: 'recording'; recording_id: number; cohort_id?: number; title: string; recorded_on: string | null; progress_percentage: number }[];
}

export interface StudentDashboardLesson {
  added_at?: string;
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
  review_status?: 'awaiting_review' | 'redo_requested' | 'reviewed' | null;
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
  personal_plan?: PersonalLearningPlan | null;
  enrollment_status?: string;
  paused_since?: string | null;
  support_instructor_id?: number | null;
  capabilities?: EnrollmentCapabilities;
  enrolled: boolean;
  user: { id: number; full_name: string; role: string };
  cohort?: {
    id: number;
    name: string;
    cohort_type: string;
    start_date: string;
    status: string;
    /** The course uses GitHub for work; only then does the learner need a GitHub username. */
    requires_github?: boolean;
    announcements?: Announcement[];
    unread_notifications_count?: number;
  };
  overall_progress?: { completed: number; total: number; percentage: number };
  modules?: StudentDashboardModule[];
  continue_lesson?: { id: number; title: string } | null;
  action_items?: {
    type: string;
    submission_id: number;
    content_block_id?: number;
    submission_type?: string;
    cohort_id?: number;
    lesson_id: number;
    lesson_title: string;
    content_block_title: string;
    feedback: string | null;
    submission_window?: SubmissionWindowStatus;
    submissions_closed?: boolean;
  }[];
  recently_graded?: {
    submission_id: number;
    content_block_id?: number;
    submission_type?: string;
    cohort_id?: number;
    lesson_id: number;
    lesson_title: string;
    content_block_title: string;
    grade: string;
    feedback: string | null;
    graded_at: string | null;
  }[];
  resources?: LearningResource[];
  /** The cohort offers weekly private meetings (booked on the web for now). */
  private_meetings_enabled?: boolean;
  office_hours?: OfficeHourOccurrence[];
}

export interface StaffDashboard {
  attention?: StaffAttention;
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

export type ProgressEntry = components['schemas']['ProgressEntry'];

export type SubmissionBrief = components['schemas']['SubmissionBrief'];

export type LessonContentBlock = components['schemas']['ContentBlockSummary'];

export interface StaffLessonSummary {
  id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
  archived_at: string | null;
  updated_at: string;
  requires_submission: boolean;
  submission_type: string;
  content_blocks_count: number;
}

export interface StaffCurriculumModule {
  id: number;
  curriculum_id: number;
  name: string;
  module_type: string;
  description: string | null;
  position: number;
  total_days: number;
  day_offset: number;
  schedule_days: string;
  updated_at: string;
  scheduled_day_names: string[];
  week_count: number;
  lessons_count: number;
  archived_lessons_count: number;
  lessons: StaffLessonSummary[];
}

export interface StaffCurriculumSummary {
  id: number;
  name: string;
  description: string | null;
  total_weeks: number;
  status: string;
  updated_at: string;
  modules_count: number;
}

export interface StaffCurriculum extends StaffCurriculumSummary {
  modules: StaffCurriculumModule[];
}

export type RubricRating = 'exceeds' | 'meets' | 'developing' | 'redo';

export type RubricCriterion = components['schemas']['RubricCriterion'];

export type Rubric = components['schemas']['Rubric'];

export interface LearningObjective {
  id: number;
  curriculum_id: number;
  code: string;
  title: string;
  description: string | null;
  success_criteria: string;
  position: number;
  active: boolean;
  alignment_count?: number;
}

export interface FeedbackSnippet {
  id: number;
  title: string;
  body: string;
  usage_count: number;
  created_by: string;
  can_manage: boolean;
}

export type KnowledgeCheckAttempt = components['schemas']['KnowledgeCheckAttempt'];

export type KnowledgeCheck = components['schemas']['KnowledgeCheck'];

export type LessonObjective = components['schemas']['LessonObjective'];

export type LessonDetail = components['schemas']['LessonDetail'];

export type LessonSubmissionType = 'manual_complete' | 'text_submission' | 'prework_github_sync' | 'repo_url_submission' | 'repo_and_live_url_submission';

export interface LessonEditorInput {
  base_updated_at: string;
  title: string;
  required: boolean;
  requires_submission: boolean;
  video?: {
    id?: number;
    title: string;
    video_url: string | null;
    s3_video_key?: string | null;
    s3_video_content_type?: string | null;
    s3_video_size?: number | null;
    video_segments?: { label: string; start_seconds: number; end_seconds: number; required: boolean }[];
  };
  exercise?: {
    id?: number;
    title: string;
    body: string | null;
    solution: string | null;
    filename: string | null;
    submission_type: LessonSubmissionType;
    submission_config: Record<string, unknown>;
    rubric_id: number | null;
  };
  retrieval_check?: {
    enabled: boolean;
    content_block_id?: number;
    title: string;
    prompt: string;
    options: string[];
    correct_option: number;
    explanation: string;
    learning_objective_id: number | null;
  };
  alignments: { learning_objective_id: number; content_block_id?: number | null }[];
}

export interface LearningObjectiveCreateInput {
  curriculum_id: number;
  code: string;
  title: string;
  description?: string;
  success_criteria: string;
  position: number;
}

export interface RubricCreateInput {
  curriculum_id: number;
  title: string;
  description?: string;
  criteria: { title: string; description: string; learning_objective_id?: number | null }[];
}

export interface ExerciseCreateInput {
  title: string;
  release_day: number;
  required: boolean;
  instructions: string;
  submission_type: LessonSubmissionType;
}

export interface CurriculumModuleInput {
  name: string;
  module_type: string;
  description?: string;
  position: number;
  total_days: number;
  day_offset: number;
  schedule_days: string;
  base_updated_at?: string;
}

// Local previews and cached legacy attempts can omit navigation metadata.
export type Submission = Omit<components['schemas']['Submission'], 'lesson_id' | 'module_id' | 'module_name'> & Partial<Pick<components['schemas']['Submission'], 'lesson_id' | 'module_id' | 'module_name'>>;

export type GithubCheckRun = components['schemas']['GithubCheckRun'];

export type GithubChecks = components['schemas']['GithubChecks'];

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
export type ActivityDestination = components['schemas']['ActivityDestination'];

export type ActivityEvent = components['schemas']['ActivityEvent'];

export type ActivityEventsResponse = components['schemas']['ActivityEventsResponse'];

export interface MessageDestination {
  message_id: number;
  thread_root_id: number;
  channel_id: number | null;
  direct_conversation_id: number | null;
  workspace_id: number;
}
export interface ThreadWindowOptions {
  around_message_id?: number;
  before_message_id?: number;
  after_message_id?: number;
  message_limit?: number;
}

import type { components } from './api.generated';

// Saved caches and synthetic previews may omit newer metadata; wire schemas stay strict.
type Preview<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type ConversationKind = 'channel' | 'dm';

// Mention pickers also consume workspace members, which omit authorization flags.
export type UserSummary = Omit<components['schemas']['UserSummary'], 'is_admin' | 'is_staff'> & Partial<Pick<components['schemas']['UserSummary'], 'is_admin' | 'is_staff'>>;

// Persisted sessions from older clients may omit policy, presence and editor preference metadata.
export type SessionUser = Omit<components['schemas']['SessionUser'], 'handle' | 'last_seen_at' | 'community_policy' | 'editor_preferences'> & Partial<Pick<components['schemas']['SessionUser'], 'handle' | 'last_seen_at' | 'editor_preferences'>> & { community_policy?: CommunityPolicy | null };

// Persisted enrollment context supports sessions saved before access-window fields.
type WireEnrollment = components['schemas']['SessionEnrollment'];
export type SessionEnrollment = Omit<WireEnrollment, 'cohort' | 'access_expires_at' | 'first_opened_at' | 'support_expires_at'> & Partial<Pick<WireEnrollment, 'access_expires_at' | 'first_opened_at' | 'support_expires_at'>> & { cohort: Omit<WireEnrollment['cohort'], 'features' | 'course_delivery'> & Partial<Pick<WireEnrollment['cohort'], 'features' | 'course_delivery'>> };

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

export type CommunityPolicy = components['schemas']['CommunityPolicy'];

export type ProfilePayload = components['schemas']['ProfileResponse'];

export type WorkspaceSummary = components['schemas']['WorkspaceSummary'];

export type WorkspaceMember = components['schemas']['WorkspaceMember'];

// Membership editors also hold locally selected people before saving.
export type WorkspaceDetail = Omit<components['schemas']['WorkspaceDetail'], 'members'> & { members: (Omit<WorkspaceMember, 'handle'> & { handle?: string | null })[] };

export type LatestMessage = NonNullable<components['schemas']['ChannelSummary']['latest_message']>;

export type ChannelSummary = components['schemas']['ChannelSummary'];

// Demo and cached people can lack authorization flags; never use them to grant access.
export type DirectConversationSummary = Omit<components['schemas']['DirectConversationSummary'], 'users'> & { users: UserSummary[] };

export type MessageReaction = components['schemas']['MessageReaction'];

// Optimistic sends and old persisted messages lack server metadata.
export type Message = Omit<components['schemas']['ChannelMessage'], 'blocked' | 'reply_count' | 'sent_via_label' | 'source' | 'pinned_by_id' | 'author'> & Partial<Pick<components['schemas']['ChannelMessage'], 'blocked' | 'reply_count' | 'sent_via_label' | 'source' | 'pinned_by_id'>> & {
  author: components['schemas']['ChannelMessage']['author'] & { email?: string };
  client_status?: 'sending' | 'failed';
  client_error?: string;
  client_uploads?: UploadAttachmentInput[];
  client_pending_attachments?: PendingAttachment[];
  client_upload_progress?: number;
};

export type ContentReport = components['schemas']['ContentReport'];

export type DataDeletionRequest = components['schemas']['DataDeletionRequest'];

export type BlockedUser = components['schemas']['BlockedUser'];

export type MessageWindowMeta = components['schemas']['MessageWindowMeta'];

export type ConversationPayload = Pick<components['schemas']['ChannelShowResponse'], 'messages' | 'pinned_messages' | 'meta'>;

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
  /** When a posted update's title or body last changed; readers see "Edited". */
  edited_at?: string | null;
  edited_by?: { id: number; full_name: string } | null;
  /** The viewer may edit, post or delete it (its author or an admin). */
  can_edit?: boolean;
  /** The viewer may archive this posted update: an admin, or staff on its cohort. */
  can_archive?: boolean;
  /** A scheduled draft's send time; the hourly tick posts it at the first run at or after it (U-3.6). */
  scheduled_for?: string | null;
  /** Why a scheduled send returned to Drafts. */
  schedule_failure?: string | null;
  scheduled_send_push?: boolean;
  schedule_time_zone?: string;
  /** Update detail only, for staff who manage a posted update: read counts, never who. */
  read_summary?: { notified: number; read: number } | null;
}

export type PaginationMeta = components['schemas']['PaginationMeta'];

export type AppNotification = components['schemas']['NotificationEntry'];

export type PushConfig = components['schemas']['PushConfigResponse'];

export type MobilePushConfig = components['schemas']['MobilePushConfig'];

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
export type HelpRequestReply = components['schemas']['HelpRequestReply'];

export type AttentionAction = Preview<components['schemas']['AttentionAction'], 'web_handoff'>;

export type AttentionReason = Omit<components['schemas']['AttentionReason'], 'action'> & { action: AttentionAction };

export type StaffAttention = Omit<components['schemas']['StaffAttention'], 'students'> & { students: SupportQueueStudent[] };

export type SupportQueueStudent = Omit<Pick<components['schemas']['SupportQueueStudent'], 'enrollment_id' | 'user_id' | 'cohort_id' | 'full_name' | 'email' | 'cohort_name' | 'progress_percentage' | 'completed_blocks' | 'total_blocks' | 'last_activity_at' | 'help_request_count' | 'urgent_help_count' | 'redo_count' | 'ungraded_count' | 'inactive' | 'active_intervention_id' | 'intervention_status' | 'follow_up_due' | 'recovery_plan_id' | 'recovery_check_in_due' | 'priority'> & Partial<Pick<components['schemas']['SupportQueueStudent'], 'needs_attention' | 'reasons' | 'next_action' | 'released_blocks' | 'released_unfinished_blocks' | 'completed_lessons' | 'total_lessons' | 'status_label'>>, 'reasons' | 'next_action'> & { reasons?: AttentionReason[]; next_action?: AttentionAction | null };

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

export type WeeklyPlanLessonItem = Preview<components['schemas']['WeeklyPlanLessonItem'], 'review_status' | 'learner_status'>;

export type EnrollmentCapabilities = components['schemas']['LearnerCapabilities'];

export type PersonalPlanLesson = Preview<components['schemas']['PersonalPlanLesson'], 'review_status' | 'learner_status'>;
export type PersonalLearningPlan = Omit<components['schemas']['PersonalLearningPlan'], 'submission_deadlines' | 'next_lesson' | 'milestones'> & { submission_deadlines?: components['schemas']['PersonalLearningPlan']['submission_deadlines']; next_lesson: PersonalPlanLesson | null; milestones: (Omit<components['schemas']['PersonalLearningPlan']['milestones'][number], 'lessons'> & { lessons: PersonalPlanLesson[] })[] };

export type WeeklyPlan = Omit<components['schemas']['WeeklyPlan'], 'personal_plan' | 'required' | 'optional' | 'redos' | 'recording_catch_up'> & { personal_plan?: PersonalLearningPlan | null; required?: WeeklyPlanLessonItem[]; optional?: WeeklyPlanLessonItem[]; redos?: Preview<NonNullable<components['schemas']['WeeklyPlan']['redos']>[number], 'content_block_id'>[]; recording_catch_up?: Preview<NonNullable<components['schemas']['WeeklyPlan']['recording_catch_up']>[number], 'cohort_id'>[] };

export type StudentDashboardLesson = Preview<components['schemas']['StudentDashboardLesson'], 'added_at' | 'release_day' | 'required' | 'review_status' | 'submission_window' | 'learner_status' | 'kind'>;

export type StudentDashboardModule = Omit<Preview<components['schemas']['StudentDashboardModule'], 'position' | 'completed_lessons' | 'total_lessons'>, 'lessons'> & { lessons: StudentDashboardLesson[] };

export type StudentDashboard = Omit<components['schemas']['DashboardData'], 'user' | 'cohort' | 'modules' | 'action_items' | 'personal_plan' | 'attention' | 'office_hours' | 'recently_graded' | 'overall_progress'> & { overall_progress?: Preview<NonNullable<components['schemas']['DashboardData']['overall_progress']>, 'completed_lessons' | 'total_lessons'>; user: Pick<components['schemas']['UserSummary'], 'id' | 'full_name' | 'role'>; cohort?: Omit<NonNullable<components['schemas']['DashboardData']['cohort']>, 'announcements'> & { cohort_type: string; announcements?: Announcement[] }; modules?: (Omit<Preview<components['schemas']['StudentDashboardModule'], 'position' | 'completed_lessons' | 'total_lessons'>, 'lessons'> & { lessons: Preview<components['schemas']['StudentDashboardLesson'], 'added_at' | 'release_day' | 'required' | 'review_status' | 'submission_window' | 'learner_status' | 'kind'>[] })[]; action_items?: Preview<NonNullable<components['schemas']['DashboardData']['action_items']>[number], 'content_block_id' | 'submission_type' | 'cohort_id' | 'submission_window' | 'submissions_closed'>[]; personal_plan?: PersonalLearningPlan | null; attention?: StaffAttention } & { resources?: LearningResource[]; office_hours?: OfficeHourOccurrence[] } & { recently_graded?: Preview<NonNullable<components['schemas']['DashboardData']['recently_graded']>[number], 'content_block_id' | 'cohort_id'>[] };

export type StaffDashboard = {
  today?: components['schemas']['InstructorToday'];
  attention?: StaffAttention;
  user: Pick<components['schemas']['DashboardUser'], 'id' | 'full_name' | 'role'>;
  cohorts: StaffCohortDashboard[];
};

export type StaffStudentSummary = Omit<Pick<components['schemas']['SupportQueueStudent'], 'user_id' | 'full_name' | 'email' | 'github_username' | 'progress_percentage' | 'completed_blocks' | 'total_blocks' | 'last_sign_in_at' | 'last_seen_at' | 'last_activity_at' | 'blocks_this_week' | 'submissions_this_week' | 'ungraded_count' | 'redo_count' | 'enrollment_status'>, 'reasons' | 'next_action'> & { reasons?: AttentionReason[]; next_action?: AttentionAction | null };

export type StaffCohortDashboard = Omit<components['schemas']['StaffCohortDashboard'], 'students'> & { students: StaffStudentSummary[] };

export interface StudentProgressDetail {
  status?: components['schemas']['StudentWorkspaceStatus'] | null;
  enrollments?: components['schemas']['StudentWorkspaceEnrollment'][];
  media_summary?: components['schemas']['StudentMediaSummary'];
  enrollment: { id: number; status: string };
  user: { id: number; full_name: string; email: string; github_username: string | null; avatar_url: string | null; last_sign_in_at: string | null; last_seen_at: string | null };
  cohort: { id: number; name: string; start_date: string; status: string };
  learning_evidence_scope?: { kind: 'curriculum' | 'enrollment'; curriculum_id: number; curriculum_name: string; enrollment_count: number; shared_across_enrollments: boolean };
  overall_progress: { completed: number; total: number; percentage: number; completed_lessons?: number; total_lessons?: number };
  modules: StaffProgressModule[];
  recent_activity: { content_block_id: number; block_title: string | null; block_type: string; completed_at: string | null }[];
}

export interface StaffProgressModule {
  completed_lessons?: number;
  total_lessons?: number;
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

export type StaffLessonSummary = components['schemas']['LessonSummary'];

export type StaffCurriculumModule = components['schemas']['CurriculumModuleDetail'];

export type StaffCurriculumSummary = components['schemas']['CurriculumSummary'];

export type StaffCurriculum = components['schemas']['CurriculumDetail'];

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
    title?: string;
    video_url: string | null;
    s3_video_key?: string | null;
    s3_video_content_type?: string | null;
    s3_video_size?: number | null;
    video_segments?: { label: string; start_seconds: number; end_seconds: number; required: boolean }[];
  };
  exercise?: {
    id?: number;
    title?: string;
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
// grading_scale is optional here: a server deployed before grading scales omits it (A / B / C / Redo).
export type Submission = Omit<components['schemas']['Submission'], 'lesson_id' | 'module_id' | 'module_name' | 'grading_scale'> & Partial<Pick<components['schemas']['Submission'], 'lesson_id' | 'module_id' | 'module_name' | 'grading_scale'>>;

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

export type MessageDestination = components['schemas']['MessageDestination'];
export interface ThreadWindowOptions {
  around_message_id?: number;
  before_message_id?: number;
  after_message_id?: number;
  message_limit?: number;
}

export type LearnerLessonStatus = components['schemas']['LearnerLessonStatus'];

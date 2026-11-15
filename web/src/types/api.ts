import type { components } from './api.generated';

// Saved caches and synthetic previews may omit newer metadata; wire schemas stay strict.
type Preview<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ─── Shared / reusable types ─────────────────────────────────────────────────

export type User = Omit<components['schemas']['SessionUser'], 'clerk_id'>;

export type CommunityPolicy = components['schemas']['CommunityPolicy'];

export type UserWithMeta = components['schemas']['SessionUser'];

export type InviteState = 'not_sent' | 'queued' | 'sent' | 'failed' | 'expired' | 'accepted';

// Optional UI flags are read by old workspace previews; users endpoints omit them.
export type UserListItem = components['schemas']['UserListItem'] & Partial<Pick<UserSummary, 'is_admin' | 'is_staff'>>;

export type UserSummary = components['schemas']['UserSummary'];

// ─── Curriculum / Content hierarchy ──────────────────────────────────────────

export interface ContentBlock {
  id: number;
  lesson_id: number;
  block_type: string;
  position: number;
  title: string | null;
  body: string | null;
  video_url: string | null;
  solution: string | null;
  filename: string | null;
  submission_type?: string | null;
  effective_submission_type?: string | null;
  submission_type_explicit?: string | null;
  submission_config?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  s3_video_key?: string | null;
  s3_video_content_type?: string | null;
  s3_video_size?: number | null;
  s3_video_duration_seconds?: number | null;
  s3_video_uploaded_at?: string | null;
  s3_video_uploaded_by?: string | null;
}

export type ContentBlockSummary = components['schemas']['ContentBlockSummary'];

export type RubricRating = 'exceeds' | 'meets' | 'developing' | 'redo';

export type RubricCriterion = components['schemas']['RubricCriterion'];

export type Rubric = components['schemas']['Rubric'];

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

export type LessonObjective = components['schemas']['LessonObjective'];

export type LessonSummary = components['schemas']['LessonSummary'];

/** Enrollment-scoped permissions supplied by the API; missing permissions never authorize writes. */
export type LearnerCapabilities = components['schemas']['LearnerCapabilities'];

export type LessonDetail = components['schemas']['LessonDetail'];

export type HelpContextType = components['schemas']['HelpContextType'];
export type HelpContextSource = components['schemas']['HelpContextSource'];
export type HelpCategory = components['schemas']['HelpCategory'];
export type HelpUrgency = components['schemas']['HelpUrgency'];
export type HelpRequestStatus = components['schemas']['HelpRequestStatus'];

export type HelpRequest = components['schemas']['HelpRequest'];

export type AttentionAction = Preview<components['schemas']['AttentionAction'], 'web_handoff'>;

export type AttentionReason = Omit<components['schemas']['AttentionReason'], 'action'> & { action: AttentionAction };

export type StaffAttention = Omit<components['schemas']['StaffAttention'], 'students'> & { students: SupportQueueStudent[] };

export type SupportQueueStudent = Omit<Pick<components['schemas']['SupportQueueStudent'], 'enrollment_id' | 'user_id' | 'cohort_id' | 'full_name' | 'email' | 'cohort_name' | 'progress_percentage' | 'completed_blocks' | 'total_blocks' | 'last_activity_at' | 'help_request_count' | 'urgent_help_count' | 'redo_count' | 'ungraded_count' | 'inactive' | 'active_intervention_id' | 'intervention_status' | 'follow_up_due' | 'recovery_plan_id' | 'recovery_check_in_due' | 'priority'> & Partial<Pick<components['schemas']['SupportQueueStudent'], 'needs_attention' | 'reasons' | 'next_action' | 'released_blocks' | 'released_unfinished_blocks'>>, 'reasons' | 'next_action'> & { reasons?: AttentionReason[]; next_action?: AttentionAction | null };

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
  evidence_snapshot: Record<string, string | number | string[] | Record<string, number>>;
  action_summary: string | null;
  next_follow_up_at: string | null;
  follow_up_due: boolean;
  outcome: InterventionOutcome | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  enrollment: {
    id: number;
    status: string;
    student: { id: number; full_name: string; email: string };
    cohort: { id: number; name: string };
  };
  owner_valid?: boolean;
  owner: { id: number; full_name: string };
  created_by: { id: number; full_name: string };
  help_request_id: number | null;
  recovery_plan_id: number | null;
  notes?: InterventionNote[];
}

export interface RecoveryPlanCheckIn {
  id: number;
  body: string;
  next_check_in_at: string | null;
  author: { id: number; full_name: string };
  created_at: string;
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
  owner_valid?: boolean;
  owner: { id: number; full_name: string };
  created_by: { id: number; full_name: string };
  enrollment_restart_id: number | null;
  intervention_id: number | null;
  check_ins?: RecoveryPlanCheckIn[];
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

export type ModuleSummary = components['schemas']['ModuleSummary'];

export type ModuleDetail = components['schemas']['ModuleDetail'];

export type CurriculumSummary = components['schemas']['CurriculumSummary'];

export type CurriculumDetail = components['schemas']['CurriculumDetail'];

// ─── Cohort / Enrollment ─────────────────────────────────────────────────────

export interface Announcement {
  unread?: boolean;
  id?: number;
  title: string;
  body: string;
  pinned: boolean;
  published_at?: string | null;
  audience?: 'cohort' | 'global' | 'staff';
  status?: 'draft' | 'published' | 'archived';
  cohort_id?: number | null;
  cohort_name?: string | null;
  read_at?: string | null;
  author?: {
    id: number;
    full_name: string;
    email: string;
  } | null;
  created_at?: string;
  updated_at?: string;
}

export type NotificationEntry = components['schemas']['NotificationEntry'];

export type PaginationMeta = components['schemas']['PaginationMeta'];

export interface AnnouncementsResponse {
  announcements: Announcement[];
  unread_count: number;
  meta: PaginationMeta;
}

export interface AnnouncementResponse {
  announcement: Announcement;
}

export type NotificationsResponse = components['schemas']['NotificationsResponse'];

export type NotificationResponse = components['schemas']['NotificationResponse'];

export type MarkAllNotificationsReadResponse = components['schemas']['MarkAllNotificationsReadResponse'];

export type PushConfigResponse = components['schemas']['PushConfigResponse'];

// Registration returns 200/201 without a JSON body.
export type PushSubscriptionResponse = void;

export type MessageNotificationPreferenceResponse = components['schemas']['MessageNotificationPreferenceResponse'];

export type WebPushNotificationPreferenceResponse = components['schemas']['WebPushNotificationPreferenceResponse'];

export type CableTokenResponse = components['schemas']['CableTokenResponse'];

export type WorkspaceSummary = components['schemas']['WorkspaceSummary'];

export type WorkspaceMember = components['schemas']['WorkspaceMember'];

export type WorkspaceDetail = components['schemas']['WorkspaceDetail'];

export type ChannelSummary = components['schemas']['ChannelSummary'];

export type MessageAttachment = components['schemas']['MessageAttachment'];

export type MessageReaction = components['schemas']['MessageReaction'];

export type ContentReport = components['schemas']['ContentReport'];

export type DataDeletionRequest = components['schemas']['DataDeletionRequest'];

export type BlockedUser = components['schemas']['BlockedUser'];

export type MessageSourceType = components['schemas']['MessageSourceType'];

export type MessageSourceSummary = components['schemas']['MessageSourceSummary'];

export type ChannelMessage = components['schemas']['ChannelMessage'];

export type DirectConversationSummary = components['schemas']['DirectConversationSummary'];

export type ChannelsResponse = components['schemas']['ChannelsResponse'];

export type ChannelResponse = components['schemas']['ChannelResponse'];

export type MessageWindowMeta = components['schemas']['MessageWindowMeta'];

export type MessageResponse = components['schemas']['MessageResponse'];

export interface ChannelMessageEvent {
  event: 'created' | 'updated' | 'deleted';
  channel_id: number | null;
  direct_conversation_id: number | null;
  message: ChannelMessage;
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

export type DirectConversationsResponse = components['schemas']['DirectConversationsResponse'];

export type DirectConversationResponse = components['schemas']['DirectConversationResponse'];

export type WorkspacesResponse = components['schemas']['WorkspacesResponse'];

export type WorkspaceResponse = components['schemas']['WorkspaceResponse'];

export type AvailableDirectUsersResponse = components['schemas']['AvailableDirectUsersResponse'];

export type MessageAttachmentPresignResponse = components['schemas']['MessageAttachmentPresignResponse'];

export type MessagePreferenceResponse = components['schemas']['MessagePreferenceResponse'];

export type MessageSearchResponse = components['schemas']['MessageSearchResponse'];

export type SubmissionWindowStatus = components['schemas']['SubmissionWindowStatus'];

export type OfficeHourOccurrence = {
  office_hour_id: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['office_hour_id'], undefined>;
  title: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['title'], undefined>;
  description: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['description'], undefined>;
  starts_at: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['starts_at'], undefined>;
  ends_at: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['ends_at'], undefined>;
  meeting_url: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['meeting_url'], undefined>;
  timezone: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['timezone'], undefined>;
  recurrence: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['recurrence'], undefined>;
  event_kind: Exclude<NonNullable<components['schemas']['OfficeHourOccurrence']>['event_kind'], undefined>;
};

export interface OfficeHour {
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
  occurrences: OfficeHourOccurrence[];
  created_by?: {
    id: number;
    full_name: string;
    email: string;
  } | null;
}

export type WeeklyPlanLessonItem = Preview<components['schemas']['WeeklyPlanLessonItem'], 'review_status'>;

export type PersonalPlanLesson = Preview<components['schemas']['PersonalPlanLesson'], 'review_status'>;
export type PersonalLearningPlan = Omit<components['schemas']['PersonalLearningPlan'], 'submission_deadlines' | 'next_lesson' | 'milestones'> & { submission_deadlines?: components['schemas']['PersonalLearningPlan']['submission_deadlines']; next_lesson: PersonalPlanLesson | null; milestones: Array<Omit<components['schemas']['PersonalLearningPlan']['milestones'][number], 'lessons'> & { lessons: PersonalPlanLesson[] }> };

export type WeeklyPlan = Omit<components['schemas']['WeeklyPlan'], 'personal_plan' | 'required' | 'optional' | 'redos' | 'recording_catch_up'> & { personal_plan?: PersonalLearningPlan | null; required?: WeeklyPlanLessonItem[]; optional?: WeeklyPlanLessonItem[]; redos?: Array<Preview<NonNullable<components['schemas']['WeeklyPlan']['redos']>[number], 'content_block_id'>>; recording_catch_up?: Array<Preview<NonNullable<components['schemas']['WeeklyPlan']['recording_catch_up']>[number], 'cohort_id'>> };

export interface CohortSummary extends Partial<CourseOfferingTerms> {
  course_delivery?: 'program' | 'guided' | 'self_paced';
  id: number;
  name: string;
  cohort_type: string;
  curriculum_id: number;
  curriculum_name: string;
  start_date: string;
  end_date: string | null;
  github_organization_name: string | null;
  repository_name: string | null;
  requires_github: boolean;
  status: string;
  settings: Record<string, unknown>;
  enrolled_count: number;
  active_count: number;
  announcements: Announcement[];
}

export interface CohortStudent {
  enrollment_id: number;
  user_id: number;
  full_name: string;
  email: string;
  github_username: string | null;
  status: string;
  enrolled_at: string | null;
  invited_at: string | null;
  joined_at: string | null;
  last_sign_in_at: string | null;
  invite_pending?: boolean;
  invite_delivery_status?: 'not_sent' | 'queued' | 'sent' | 'failed' | 'accepted';
  invite_sent_at?: string | null;
  invite_last_error?: string | null;
  module_assignments: {
    id: number;
    module_id: number;
    module_name: string;
    unlocked: boolean;
    unlock_date_override: string | null;
  }[];
}

export type GithubAccessStatus = 'member' | 'invited' | 'not_invited' | 'username_missing';
export interface GithubAccessResponse {
  organization: string;
  checked_at: string;
  statuses: Record<string, GithubAccessStatus>;
}

export interface CohortModule {
  id: number;
  name: string;
  module_type: string;
  position: number;
  lessons_count: number;
  assigned_count: number;
  assigned: boolean;
  unlocked_count: number;
  accessible_count: number;
  module_start_date: string;
  uses_default_start_date: boolean;
  requires_github?: boolean;
  repository_name?: string;
  week_count?: number;
  submission_windows?: SubmissionWindowStatus[];
}

export interface CohortDetail extends CohortSummary {
  students: CohortStudent[];
  modules: CohortModule[];
  uploaded_recordings_count?: number;
  recordings?: Array<{ title: string; url: string; date?: string; description?: string }>;
  class_resources?: Array<{ title: string; url: string; category?: string; description?: string }>;
  office_hours?: OfficeHour[];
  office_hour_occurrences?: OfficeHourOccurrence[];
}

export interface CourseOfferingTerms {
  public_checkout_enabled: boolean;
  public_price_cents: number | null;
  stripe_price_id: string | null;
  support_instructor_id: number | null;
  self_paced_access_months: number;
  self_paced_support_weeks: number;
  offering_readiness: Record<'curriculum_assigned' | 'price_set' | 'support_instructor_set' | 'published_content' | 'cohort_active', boolean>;
}

export type DashboardData = Omit<components['schemas']['DashboardData'], 'user' | 'cohort' | 'modules' | 'action_items' | 'personal_plan' | 'attention'> & { user: Pick<components['schemas']['UserSummary'], 'id' | 'full_name' | 'role'>; cohort?: Omit<NonNullable<components['schemas']['DashboardData']['cohort']>, 'announcements'> & { announcements?: Announcement[] }; modules?: Array<Omit<Preview<components['schemas']['StudentDashboardModule'], 'position'>, 'lessons'> & { lessons: Array<Preview<components['schemas']['StudentDashboardLesson'], 'added_at' | 'release_day' | 'required' | 'review_status' | 'submission_window'>> }>; action_items?: Array<Preview<NonNullable<components['schemas']['DashboardData']['action_items']>[number], 'content_block_id' | 'submission_type' | 'cohort_id' | 'submission_window' | 'submissions_closed'>>; personal_plan?: PersonalLearningPlan | null; attention?: StaffAttention };

export interface CohortStudentViewLesson {
  id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
  unlock_date: string | null;
  available: boolean;
  content_blocks_count: number;
  completion_blocks_count: number;
  requires_submission: boolean;
  submission_type: string;
  submission_window?: SubmissionWindowStatus;
}

export interface CohortStudentViewModule {
  id: number;
  name: string;
  module_type: string;
  position: number;
  assigned: boolean;
  available: boolean;
  module_start_date: string | null;
  repository_name: string | null;
  requires_github: boolean;
  lessons_count: number;
  visible_lessons_count: number;
  locked_lessons_count: number;
  lessons: CohortStudentViewLesson[];
}

export interface CohortStudentView {
  cohort: {
    id: number;
    name: string;
    cohort_type: string;
    status: string;
    start_date: string;
    end_date: string | null;
    curriculum_name: string;
    active_count: number;
  };
  read_only: boolean;
  generated_at: string;
  summary: {
    assigned_modules: number;
    available_modules: number;
    locked_modules: number;
    total_lessons: number;
    visible_lessons: number;
    locked_lessons: number;
  };
  modules: CohortStudentViewModule[];
  dashboard: DashboardData;
  weekly_plan?: WeeklyPlan | null;
  announcements: Announcement[];
  resources: Array<{ id: number; title: string; url: string; category: string; description: string | null }>;
  office_hours?: OfficeHourOccurrence[];
  recordings: {
    uploaded_count: number;
    legacy_count: number;
    items: Array<{
      id: number | string;
      title: string;
      description: string | null;
      source: 'uploaded' | 'youtube' | 'vimeo' | 'loom' | 'direct' | 'external';
      url?: string;
      date?: string | null;
      recorded_date?: string | null;
      duration_display?: string | null;
    }>;
  };
}

export interface EnrollmentSummary {
  id: number;
  user_id: number;
  cohort_id: number;
  user_name: string;
  user_email: string;
  status: string;
  enrolled_at: string | null;
  completed_at: string | null;
  module_assignments: {
    id: number;
    module_id: number;
    module_name: string;
    unlocked: boolean;
    unlock_date_override: string | null;
  }[];
  total_blocks?: number;
  completed_blocks?: number;
  progress_percentage?: number;
}

export interface ModuleAssignment {
  id: number;
  enrollment_id: number;
  module_id: number;
  module_name: string;
  module_type: string;
  unlocked: boolean;
  unlock_date_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonAssignment {
  id: number;
  enrollment_id: number;
  lesson_id: number;
  lesson_title: string;
  unlocked: boolean;
  unlock_date_override: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Submissions / Progress ──────────────────────────────────────────────────

export type SubmissionBrief = components['schemas']['SubmissionBrief'];

export type Submission = components['schemas']['Submission'];

export type GithubCheckRun = components['schemas']['GithubCheckRun'];

export type GithubChecks = components['schemas']['GithubChecks'];

export type ProgressEntry = components['schemas']['ProgressEntry'];

// ─── Recordings / Resources ──────────────────────────────────────────────────

export type RecordingEntry = components['schemas']['RecordingEntry'];

export type RecordingItem = components['schemas']['RecordingItem'];

export interface ResourceEntry {
  id: number | string;
  title: string;
  url: string;
  category: string;
  description: string | null;
  download_id?: number;
  curriculum_id?: number;
  filename?: string;
  file_size?: number;
  ready?: boolean;
}

// First-class recording library entries (returned by /api/v1/cohorts/:id/recordings)
export type S3RecordingWatchProgress = components['schemas']['S3RecordingWatchProgress'];

export type S3Recording = components['schemas']['S3Recording'];

export type CohortRecordingsResponse = components['schemas']['CohortRecordingsResponse'];

export type RecordingResponse = components['schemas']['RecordingResponse'];

// ─── Watch progress ──────────────────────────────────────────────────────────

export type WatchProgressUpdate = components['schemas']['WatchProgressUpdate'];

export type WatchProgressUpdateResponse = components['schemas']['WatchProgressUpdateResponse'];

export type VideoProgressEntry = components['schemas']['VideoProgressEntry'];

export type VideoStreamResponse = components['schemas']['VideoStreamResponse'];

export type VideoProgressResponse = components['schemas']['VideoProgressResponse'];

// Per-recording progress row used by the cohort watch-progress matrix.
export interface CohortWatchProgressRow {
  recording_id: number;
  progress_percentage: number;
  completed: boolean;
  total_watched_seconds: number;
}

export interface CohortWatchProgressStudent {
  user_id: number;
  full_name: string;
  recordings: CohortWatchProgressRow[];
}

export interface CohortWatchProgressResponse {
  recordings: { id: number; title: string; duration_seconds: number | null }[];
  students: CohortWatchProgressStudent[];
}

// Per-video progress row used by the cohort lesson-video matrix.
export interface CohortLessonVideoProgressRow {
  content_block_id: number;
  progress_percentage: number;
  completed: boolean;
  total_watched_seconds: number;
}

export interface CohortLessonVideoProgressStudent {
  user_id: number;
  full_name: string;
  videos: CohortLessonVideoProgressRow[];
}

export interface CohortLessonVideoProgressResponse {
  videos: {
    id: number;
    title: string;
    lesson_title: string;
    module_title: string;
    duration_seconds: number | null;
  }[];
  students: CohortLessonVideoProgressStudent[];
}

// Per-student watch progress (cohort recordings).
export interface StudentRecordingProgress {
  recording_id: number;
  recording_title: string;
  cohort_id: number;
  cohort_name: string;
  last_position_seconds: number;
  total_watched_seconds: number;
  duration_seconds: number | null;
  progress_percentage: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface StudentWatchProgressResponse {
  watch_progresses: StudentRecordingProgress[];
}

// Per-student watch progress (in-lesson S3 video blocks).
export interface StudentLessonVideoProgress {
  content_block_id: number;
  title: string;
  lesson_title: string;
  module_title: string;
  cohort_id: number;
  cohort_name: string;
  duration_seconds: number | null;
  last_position_seconds: number;
  total_watched_seconds: number;
  progress_percentage: number;
  completed: boolean;
  completed_at: string | null;
  last_watched_at: string | null;
}

export interface StudentLessonVideoProgressResponse {
  lesson_videos: StudentLessonVideoProgress[];
}

export interface ReorderRecordingsResponse {
  recordings: S3Recording[];
}

// ─── Session ─────────────────────────────────────────────────────────────────

export type SessionEnrollment = components['schemas']['SessionEnrollment'];

export type ProfileEnrollment = components['schemas']['ProfileEnrollment'];

export type UserEnrollment = components['schemas']['UserEnrollment'];

// ─── Student progress (admin) ────────────────────────────────────────────────

export interface StudentProgressBlock {
  id: number;
  title: string;
  block_type: string;
  position: number;
  status: string;
  completed_at: string | null;
  submission: {
    id: number;
    grade: string | null;
    feedback: string | null;
    submitted_at: string;
    graded_at: string | null;
  } | null;
}

export interface StudentProgressLesson {
  review_status?: 'awaiting_review' | 'redo_requested' | 'reviewed' | null;
  submission_window?: SubmissionWindowStatus;
  id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
  assigned?: boolean;
  available: boolean;
  unlock_date: string | null;
  total_blocks: number;
  completed_blocks: number;
  completed: boolean;
  lesson_assignment: {
    id: number;
    unlocked: boolean;
    unlock_date_override: string | null;
  } | null;
  blocks: StudentProgressBlock[];
}

export interface StudentProgressModule {
  id: number;
  name: string;
  module_type: string;
  position: number;
  total_blocks: number;
  completed_blocks: number;
  progress_percentage: number;
  lessons: StudentProgressLesson[];
}

export interface StudentProgressResponse {
  weekly_plan?: WeeklyPlan | null;
  personal_plan?: PersonalLearningPlan | null;
  enrollment: {
    restart_version?: string | null;
    first_opened_at?: string | null;
    id: number;
    status: string;
    access_expires_at?: string | null;
    support_expires_at?: string | null;
    module_assignments: {
      id: number;
      module_id: number;
      module_name: string;
      module_type: string;
      unlocked: boolean;
      unlock_date_override: string | null;
      available: boolean;
      next_unlock_date: string | null;
    }[];
  };
  user: {
    id: number;
    full_name: string;
    email: string;
    github_username: string | null;
    avatar_url: string | null;
    last_sign_in_at: string | null;
    last_seen_at: string | null;
  };
  cohort: { id: number; name: string; start_date: string; status: string; course_delivery?: 'program' | 'guided' | 'self_paced' };
  learning_evidence_scope?: {
    kind: 'curriculum';
    curriculum_id: number;
    curriculum_name: string;
    enrollment_count: number;
    shared_across_enrollments: boolean;
  };
  overall_progress: { completed: number; total: number; percentage: number };
  modules: StudentProgressModule[];
  recent_activity: {
    content_block_id: number;
    block_title: string;
    block_type: string;
    completed_at: string;
  }[];
}

export type LearningEvidenceStatus = 'demonstrated' | 'developing' | 'needs_revision' | 'not_evidenced';

export interface LearningEvidenceItem {
  id: string;
  kind: 'rubric_criterion' | 'aligned_submission' | 'knowledge_check';
  state: string;
  label: string;
  value: string;
  occurred_at: string;
  submission_id?: number;
  knowledge_check_id?: number;
  attempt_id?: number;
  attempt_count?: number;
  content_block_id: number;
  lesson_id: number;
  module_id: number;
  current_submission: boolean;
  github_checks: Pick<GithubChecks['summary'], 'total' | 'passed' | 'failed' | 'pending'> | null;
}

export interface LearningInsightStudent {
  enrollment_id: number;
  user: { id: number; full_name: string; email: string };
  status: LearningEvidenceStatus;
  evidence_count: number;
  last_evidence_at: string | null;
  evidence: LearningEvidenceItem[];
}

export interface LearningInsightObjective {
  id: number;
  code: string;
  title: string;
  description: string | null;
  success_criteria: string;
  demonstrated_count: number;
  learner_count: number;
  demonstrated_percentage: number;
  status_counts: Record<LearningEvidenceStatus, number>;
  students: LearningInsightStudent[];
}

export interface LearningRevisionPattern {
  content_block: { id: number; title: string };
  lesson: { id: number; title: string };
  module: { id: number; name: string };
  objective_ids: number[];
  learners_with_work: number;
  affected_learner_count: number;
  open_redo_count: number;
  redo_percentage: number;
  repeat_attempt_count: number;
  failed_check_count: number;
  records: Array<{
    submission_id: number;
    user: { id: number; full_name: string };
    grade: string | null;
    attempt_count: number;
    github_checks: Pick<GithubChecks['summary'], 'total' | 'passed' | 'failed' | 'pending'>;
    updated_at: string;
  }>;
}

export interface LearningInsights {
  generated_at: string;
  evidence_scope: { kind: 'curriculum'; curriculum_id: number; curriculum_name: string; completion_and_watch_time_excluded: boolean };
  cohort: { id: number; name: string };
  summary: {
    objective_count: number;
    learner_count: number;
    demonstrated_count: number;
    developing_count: number;
    needs_revision_count: number;
    not_evidenced_count: number;
    open_redo_count: number;
    revision_pattern_count: number;
  };
  rule: {
    version: string;
    demonstrated: string;
    needs_revision: string;
    developing: string;
    not_evidenced: string;
    automation_boundary: string;
  };
  objectives: LearningInsightObjective[];
  revision_patterns: LearningRevisionPattern[];
}

export interface LearningInsightsResponse { learning_insights: LearningInsights }
export interface GithubChecksResponse { github_checks: GithubChecks }

// ─── API Response wrappers ───────────────────────────────────────────────────

export type SessionResponse = components['schemas']['SessionResponse'];

export type DashboardResponse = { dashboard: DashboardData };

export type WeeklyPlanResponse = components['schemas']['WeeklyPlanResponse'];

export type ProfileResponse = components['schemas']['ProfileResponse'];

export type ProfileUpdateResponse = components['schemas']['ProfileUpdateResponse'];

export type ModuleResponse = components['schemas']['ModuleResponse'];

export type LessonResponse = components['schemas']['LessonResponse'];

export type HelpRequestsResponse = components['schemas']['HelpRequestsResponse'];

export type HelpRequestResponse = components['schemas']['HelpRequestResponse'];

export interface SupportQueueResponse {
  support_queue: SupportQueue;
}

export interface InterventionsResponse {
  interventions: Intervention[];
}

export interface InterventionResponse {
  intervention: Intervention;
}

export interface RecoveryPlansResponse {
  recovery_plans: RecoveryPlan[];
}

export interface RecoveryPlanResponse {
  recovery_plan: RecoveryPlan;
}

export type SubmissionsListResponse = components['schemas']['SubmissionsListResponse'];

export type SubmissionResponse = components['schemas']['SubmissionResponse'];

export type ProgressListResponse = components['schemas']['ProgressListResponse'];

export type ProgressUpdateResponse = components['schemas']['ProgressUpdateResponse'];

export type RecordingsResponse = components['schemas']['RecordingsResponse'];

export interface ResourcesResponse {
  resources: ResourceEntry[];
}

export type UsersListResponse = Omit<components['schemas']['UsersListResponse'], 'users'> & { users: UserListItem[] };

export type UserDetailResponse = components['schemas']['UserDetailResponse'];

export type UserUpdateResponse = components['schemas']['UserUpdateResponse'];

export type CurriculaListResponse = components['schemas']['CurriculaListResponse'];

export type CurriculumResponse = components['schemas']['CurriculumResponse'];

export interface CohortsListResponse {
  cohorts: CohortSummary[];
}

export interface CohortResponse {
  cohort: CohortDetail;
}

export interface AccessibleCohort {
  capabilities?: LearnerCapabilities;
  features?: Record<string, boolean>;
  id: number;
  name: string;
  status: string;
  cohort_type: string;
  curriculum_name: string;
  workspace_id: number | null;
  enrollment_status?: string | null;
}

export interface AccessibleCohortsResponse {
  cohorts: AccessibleCohort[];
}

export interface CohortHomeStudent {
  user_id: number;
  enrollment_id: number;
  full_name: string;
  email: string;
  status: string;
  invited_at: string | null;
  joined_at: string | null;
  invite_delivery_status: 'not_sent' | 'queued' | 'sent' | 'failed' | 'accepted';
  progress_percentage: number;
  ungraded_count: number;
  redo_count: number;
  assigned_module_count?: number;
  last_seen_at: string | null;
}

export interface CohortHome {
  attention?: StaffAttention;
  cohort: {
    id: number;
    name: string;
    status: string;
    cohort_type?: string;
    curriculum_name: string;
    start_date: string | null;
    end_date: string | null;
    workspace_id: number | null;
  };
  permissions?: {
    can_manage_roster: boolean;
    can_manage_schedule: boolean;
    can_manage_learning_schedule: boolean;
    can_grade: boolean;
    can_announce: boolean;
  };
  counts?: {
    invited: number;
    joined: number;
    active_students: number;
    ungraded: number;
    redos: number;
    open_help: number;
    without_modules?: number;
  };
  students?: CohortHomeStudent[];
  upcoming_events: Array<{
    id: number | string;
    title: string;
    starts_at: string;
    ends_at?: string | null;
    timezone?: string;
    event_kind?: 'office_hours' | 'live_class';
    meeting_url?: string | null;
  }>;
  recent_announcements: Array<{ id: number; title: string; published_at: string | null; pinned: boolean }>;
  own_progress_percentage?: number;
}

export interface CohortHomeResponse {
  home: CohortHome;
}

export interface CohortInstructorAssignment {
  id: number;
  full_name: string;
  email: string;
}

export interface CohortInstructorAssignmentsResponse {
  instructors: CohortInstructorAssignment[];
}

export interface CohortStudentViewResponse {
  student_view: CohortStudentView;
}

export interface SubmissionWindowsResponse {
  submission_windows: SubmissionWindowStatus[];
}

export interface OfficeHoursResponse {
  office_hours: OfficeHour[];
  upcoming: OfficeHourOccurrence[];
}

export interface OfficeHourResponse {
  office_hour: OfficeHour;
}

export interface PrivateMeetingSlot {
  id: number;
  starts_at: string;
  ends_at: string;
  instructor_id: number;
  instructor_name: string;
  available: boolean;
}

export interface PrivateMeetingBooking {
  id: number;
  cohort_id: number;
  student_name?: string;
  student_id?: number;
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  zoom_url: string | null;
  status: string;
  week_number: number;
  reschedule_count: number;
}

export interface PrivateMeetingCohort {
  timezone?: string;
  duration_minutes?: number;
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  instructor_id?: number;
  instructor_name: string;
  weeks: number;
  reschedule_cutoff_hours: number;
  max_student_changes: number;
  bookable_week_numbers: number[];
  bookings: PrivateMeetingBooking[];
  slots: PrivateMeetingSlot[];
}

export interface StaffPrivateMeetingCohort extends Omit<PrivateMeetingCohort, 'bookable_week_numbers'> {
  instructor_id: number;
}

export interface PrivateMeetingsResponse {
  cohorts: PrivateMeetingCohort[];
}

export interface StaffPrivateMeetingsResponse {
  cohorts: StaffPrivateMeetingCohort[];
}

export interface PrivateMeetingResponse {
  booking: PrivateMeetingBooking;
}

export interface PrivateMeetingSlotResponse {
  slot: PrivateMeetingSlot;
}

export interface EnrollmentsListResponse {
  enrollments: EnrollmentSummary[];
}

export interface EnrollmentResponse {
  enrollment: EnrollmentSummary;
  invitation?: {
    status: 'not_sent' | 'queued' | 'sent' | 'failed' | 'accepted' | 'not_needed';
    error: string | null;
  };
}

export interface ModuleAssignmentsListResponse {
  module_assignments: ModuleAssignment[];
}

export interface ModuleAssignmentResponse {
  module_assignment: ModuleAssignment;
}

export interface LessonAssignmentsListResponse {
  lesson_assignments: LessonAssignment[];
}

export interface LessonAssignmentResponse {
  lesson_assignment: LessonAssignment;
}

export interface ContentBlockResponse {
  content_block: ContentBlock;
}

export interface ContentBlocksListResponse {
  content_blocks: ContentBlock[];
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

export interface LearningPlanInput {
  active: boolean;
  title: string;
  description: string | null;
  target_date: string | null;
  next_check_in_on: string | null;
  milestones: Array<{ title: string; due_on: string; lesson_ids: number[] }>;
  lesson_overrides: Array<{ lesson_id: number; required: boolean; reason: string }>;
  lock_version?: number;
}
export interface LearningPlanManagement {
  learning_plan: (LearningPlanInput & { id: number; updated_at: string; lock_version: number }) | null;
  lessons: Array<{ id: number; title: string; module_name: string; standard_required: boolean }>;
  revisions: Array<{ id: number; author: string; created_at: string; snapshot: LearningPlanInput }>;
}

export type AgentPostingToken = components['schemas']['AgentPostingToken'];

export type StudentLibraryRecording = components['schemas']['StudentLibraryRecording'];

export type VideoProgressInput = components['schemas']['VideoProgressInput'];
export type WatchProgressInput = components['schemas']['WatchProgressInput'];

// Local optimistic messages and persisted failed sends predate server-only metadata.
export type MessageView = Omit<ChannelMessage, 'blocked' | 'reply_count' | 'sent_via_label' | 'source' | 'author'> & Partial<Pick<ChannelMessage, 'blocked' | 'reply_count' | 'sent_via_label' | 'source'>> & { author: ChannelMessage['author'] & { email?: string } };

// User discovery can be populated by session summaries or users#index (which omits role flags).
export type DirectoryUserSummary = Omit<UserSummary, 'is_admin' | 'is_staff'> & Partial<Pick<UserSummary, 'is_admin' | 'is_staff'>>;

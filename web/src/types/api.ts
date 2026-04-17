// ─── Shared / reusable types ─────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  github_username: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_staff: boolean;
}

export interface UserWithMeta extends User {
  clerk_id: string;
}

export interface UserListItem extends User {
  last_sign_in_at: string | null;
  invite_pending: boolean;
  created_at: string;
}

export interface UserSummary {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_staff: boolean;
}

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
  metadata: Record<string, unknown>;
}

export interface ContentBlockSummary {
  id: number;
  block_type: string;
  position: number;
  title: string | null;
  body: string | null;
  video_url: string | null;
  filename: string | null;
  metadata: Record<string, unknown>;
  solution?: string | null;
  progress?: { status: string; completed_at: string | null };
  submissions?: SubmissionBrief[];
}

export interface LessonSummary {
  id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
  requires_submission: boolean;
  content_blocks_count: number;
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
  content_blocks_count: number;
  content_blocks: ContentBlockSummary[];
  prev_lesson: { id: number; title: string } | null;
  next_lesson: { id: number; title: string } | null;
}

export interface ModuleSummary {
  id: number;
  curriculum_id: number;
  name: string;
  module_type: string;
  description: string | null;
  position: number;
  total_days: number | null;
  day_offset: number;
  schedule_days: string;
  scheduled_day_names: string[];
  week_count: number;
  lessons_count: number;
}

export interface ModuleDetail extends ModuleSummary {
  lessons: {
    id: number;
    title: string;
    lesson_type: string;
    position: number;
    release_day: number;
    required: boolean;
    content_blocks: ContentBlockSummary[];
  }[];
}

export interface CurriculumSummary {
  id: number;
  name: string;
  description: string | null;
  total_weeks: number | null;
  status: string;
  modules_count: number;
}

export interface CurriculumDetail extends CurriculumSummary {
  modules: {
    id: number;
    curriculum_id: number;
    name: string;
    module_type: string;
    description: string | null;
    position: number;
    total_days: number | null;
    day_offset: number;
    schedule_days: string;
    scheduled_day_names: string[];
    week_count: number;
    lessons_count: number;
    lessons: LessonSummary[];
  }[];
}

// ─── Cohort / Enrollment ─────────────────────────────────────────────────────

export interface Announcement {
  title: string;
  body: string;
  pinned: boolean;
  published_at: string;
}

export interface CohortSummary {
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
  last_sign_in_at: string | null;
  module_assignments: {
    id: number;
    module_id: number;
    module_name: string;
    unlocked: boolean;
    unlock_date_override: string | null;
  }[];
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
  unlock_date_overrides: string[];
  requires_github?: boolean;
  repository_name?: string;
}

export interface CohortDetail extends CohortSummary {
  students: CohortStudent[];
  modules: CohortModule[];
  recordings?: Array<{ title: string; url: string; date?: string; description?: string }>;
  class_resources?: Array<{ title: string; url: string; category?: string; description?: string }>;
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

export interface SubmissionBrief {
  id: number;
  text: string;
  grade: string | null;
  feedback: string | null;
  graded_at: string | null;
  num_submissions: number;
  created_at: string;
}

export interface Submission {
  id: number;
  content_block_id: number;
  user_id: number;
  user_name: string;
  text: string;
  grade: string | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  github_issue_url: string | null;
  github_code_url: string | null;
  num_submissions: number;
  created_at: string;
  content_block_title: string;
  content_block_type: string;
  lesson_title: string;
  filename: string | null;
  language_hint: string | null;
  solution?: string;
  exercise_body?: string;
  exercise_video_url?: string;
}

export interface ProgressEntry {
  id: number;
  content_block_id: number;
  status: string;
  completed_at: string | null;
}

// ─── Recordings / Resources ──────────────────────────────────────────────────

export interface RecordingEntry {
  id: number;
  title: string;
  url: string;
  date: string | null;
  description: string | null;
}

export interface ResourceEntry {
  id: number;
  title: string;
  url: string;
  category: string;
  description: string | null;
}

// S3-backed recordings (returned by /api/v1/cohorts/:id/recordings)
export interface S3RecordingWatchProgress {
  last_position_seconds: number;
  total_watched_seconds: number;
  progress_percentage: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface S3Recording {
  id: number;
  cohort_id?: number;
  title: string;
  description: string | null;
  content_type: string;
  file_size: number;
  file_size_display: string;
  duration_seconds: number | null;
  duration_display: string | null;
  position: number;
  recorded_date: string | null;
  created_at: string;
  // staff-only
  s3_key?: string;
  uploaded_by?: string | null;
  // student-scoped (only present when the controller adds it; treated as
  // nullable here so callers don't have to special-case `undefined` vs `null`).
  watch_progress?: S3RecordingWatchProgress | null;
}

export interface CohortRecordingsResponse {
  recordings: S3Recording[];
}

export interface RecordingResponse {
  recording: S3Recording;
}

// ─── Watch progress ──────────────────────────────────────────────────────────

export interface WatchProgressUpdate {
  recording_id: number;
  last_position_seconds: number;
  total_watched_seconds: number;
  progress_percentage: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface WatchProgressUpdateResponse {
  watch_progress: WatchProgressUpdate;
}

export interface VideoProgressEntry {
  content_block_id: number;
  last_position: number;
  total_watched: number;
  duration: number | null;
  status: string;
  completed?: boolean;
}

export interface VideoStreamResponse {
  stream_url: string;
  video_progress: VideoProgressEntry | null;
}

export interface VideoProgressResponse {
  video_progress: VideoProgressEntry;
}

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
}

export interface ProfileEnrollment {
  id: number;
  cohort_name: string;
  curriculum_name: string;
  status: string;
  enrolled_at: string | null;
}

export interface UserEnrollment {
  id: number;
  cohort_id: number;
  cohort_name: string;
  status: string;
  enrolled_at: string | null;
  completed_at: string | null;
}

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
  id: number;
  title: string;
  lesson_type: string;
  position: number;
  release_day: number;
  required: boolean;
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
  enrollment: {
    id: number;
    status: string;
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
  };
  cohort: { id: number; name: string; start_date: string; status: string };
  overall_progress: { completed: number; total: number; percentage: number };
  modules: StudentProgressModule[];
  recent_activity: {
    content_block_id: number;
    block_title: string;
    block_type: string;
    completed_at: string;
  }[];
}

// ─── API Response wrappers ───────────────────────────────────────────────────

export interface SessionResponse {
  user: UserWithMeta;
  enrollments: SessionEnrollment[];
}

export interface DashboardResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dashboard: any;
}

export interface ProfileResponse {
  user: User;
  enrollments: ProfileEnrollment[];
}

export interface ProfileUpdateResponse {
  user: Omit<User, 'role' | 'is_admin' | 'is_staff'>;
}

export interface ModuleResponse {
  module: ModuleDetail;
}

export interface LessonResponse {
  lesson: LessonDetail;
}

export interface SubmissionsListResponse {
  submissions: Submission[];
}

export interface SubmissionResponse {
  submission: Submission;
}

export interface ProgressListResponse {
  progress: ProgressEntry[];
}

export interface ProgressUpdateResponse {
  progress: ProgressEntry;
}

export interface RecordingsResponse {
  recordings: RecordingEntry[];
  s3_recordings?: S3Recording[];
  cohort_id?: number;
}

export interface ResourcesResponse {
  resources: ResourceEntry[];
}

export interface UsersListResponse {
  users: UserListItem[];
}

export interface UserDetailResponse {
  user: UserListItem;
  enrollments: UserEnrollment[];
}

export interface UserUpdateResponse {
  user: UserListItem;
}

export interface CurriculaListResponse {
  curricula: CurriculumSummary[];
}

export interface CurriculumResponse {
  curriculum: CurriculumDetail;
}

export interface CohortsListResponse {
  cohorts: CohortSummary[];
}

export interface CohortResponse {
  cohort: CohortDetail;
}

export interface EnrollmentsListResponse {
  enrollments: EnrollmentSummary[];
}

export interface EnrollmentResponse {
  enrollment: EnrollmentSummary;
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

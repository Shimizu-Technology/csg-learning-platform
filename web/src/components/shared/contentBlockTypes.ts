import type { LessonReturn } from '../../lib/hafaStarterLinks'
export interface ContentBlock {
  id: number
  block_type: string
  position: number
  title: string | null
  body: string | null
  video_url: string | null
  filename: string | null
  effective_submission_type?: string | null
  submission_type?: string | null
  submission_config?: Record<string, any>
  solution?: string | null
  metadata: Record<string, any>
  knowledge_check?: import('../../types/api').KnowledgeCheck | null
  s3_video_key?: string | null
  learner_state?: string
  progress?: { status: string; completed_at: string | null; video_last_position?: number; video_total_watched?: number }
  submissions?: Array<{
    id: number
    submission_type?: string | null
    text: string | null
    grade: string | null
    feedback: string | null
    graded_at: string | null
    github_issue_url?: string | null
    github_code_url?: string | null
    repo_url?: string | null
    pr_url?: string | null
    live_url?: string | null
    branch?: string | null
    commit_sha?: string | null
    notes?: string | null
    num_submissions: number
    created_at: string
    updated_at?: string
  }>
}

export interface ContentBlockRendererProps {
  block: ContentBlock
  cohortId?: number
  isStaff?: boolean
  requiresGithub?: boolean
  requiresSubmission?: boolean
  repositoryName?: import('../../types/api').LessonDetail['repository_name']
  githubSetupShown?: boolean
  readOnly?: boolean
  submissionsLocked?: boolean
  submissionsCloseAt?: string | null
  submissionWeekNumber?: number
  analyticsContext?: { moduleId: number; lessonId: number }
  /** The lesson this block renders in; Hafa Code starter links return here. */
  lessonReturn?: LessonReturn
  /** Always open Hafa Code starters in a new tab (editor preview keeps unsaved edits). */
  starterOpensNewTab?: boolean
  reviewerName?: string
  completionInFooter?: boolean
  onProgressUpdate?: () => void
}

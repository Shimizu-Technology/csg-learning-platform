/** What each activity event says happened, as staff read it (School activity, cohort Activity, the event page). */
export const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  account_signed_in: 'Signed in', checkpoint_completed: 'Marked complete', checkpoint_reopened: 'Marked not complete',
  video_started: 'Started a lesson video', video_completed: 'Completed a lesson video', recording_started: 'Started a recording', recording_completed: 'Completed a recording',
  submission_created: 'Submitted work', submission_updated: 'Resubmitted or updated work', submission_graded: 'Reviewed work',
  lesson_editing_granted: 'Gave lesson editing access', lesson_editing_revoked: 'Removed lesson editing access', curriculum_copied: "Made the cohort's own copy of its curriculum",
}

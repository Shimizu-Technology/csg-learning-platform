# When a learner last did something in one enrollment: the one "last active"
# every staff surface shows (U-0.5) and the clock the attention list's
# inactivity reason runs on (AttentionProjection).
#
# Learning activity is what the learner did in that cohort: a submission, a
# learner-originated ActivityEvent (marking a step complete, starting or
# finishing a video or recording, ...) or a retrieval-check attempt (those
# complete progress without an event). Asking for help is not learning
# activity: an open help request is its own attention reason, and resolving it
# must not hide inactivity (AttentionProjectionTest). Signing in and being
# seen are account-wide, so they would hide inactivity in one enrollment behind
# activity in another; staff grading is not the learner's activity. Events
# from before the enrollment started belong to an earlier enrollment.
#
# `for_all` answers for many enrollments in three queries.
class LearnerActivity
  EXCLUDED_EVENTS = %w[account_signed_in submission_graded].freeze

  def self.for_all(enrollments)
    enrollments = enrollments.to_a
    return {} if enrollments.empty?

    ids = enrollments.map(&:id)
    submitted = Submission.where(enrollment_id: ids).group(:enrollment_id).maximum(:created_at)
    events = ActivityEvent.where(cohort_id: enrollments.map(&:cohort_id).uniq, subject_user_id: enrollments.map(&:user_id).uniq)
      .where("actor_id = subject_user_id").where.not(event_type: EXCLUDED_EVENTS)
      .group(:subject_user_id, :cohort_id).maximum(:created_at)
    attempts = KnowledgeCheckAttempt.where(enrollment_id: ids).group(:enrollment_id).maximum(:created_at)

    enrollments.to_h do |enrollment|
      event = events[[ enrollment.user_id, enrollment.cohort_id ]]
      event = nil if event && event < (enrollment.enrolled_at || enrollment.created_at)
      [ enrollment.id, [ submitted[enrollment.id], event, attempts[enrollment.id] ].compact.max ]
    end
  end

  def self.last_active_at(enrollment)
    for_all([ enrollment ])[enrollment.id]
  end
end

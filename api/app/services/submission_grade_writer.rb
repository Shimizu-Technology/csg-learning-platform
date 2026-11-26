# Saves one grade. The single review (PATCH /submissions/:id/grade) and batch
# approval (POST /submissions/batch_grade) both write through here, so the two
# never record a grade differently.
#
# `record!` runs inside the caller's transaction, after the caller has taken
# the canonical locks (curriculum FOR SHARE, then the enrollment, then the
# submission) and checked the attempt is still the latest, unchanged and on
# the locked scale. `deliver!` runs after that transaction commits: email,
# notification jobs and legacy GitHub issue calls never run under the locks.
class SubmissionGradeWriter
  class InvalidSuggestionDecision < StandardError; end

  attr_reader :submission

  def initialize(submission:, grader:, school_features: FeatureSwitches.school(read_only: true))
    @submission = submission
    @grader = grader
    @school_features = school_features
    enrollment = submission.enrollment
    @use_v2_issue_delivery = GithubIssueDeliveryPlanner.enabled_for?(enrollment&.cohort)
    @suggestions_enabled = GithubGradeSuggestionEvaluator.enabled_for?(enrollment&.cohort, school: school_features)
  end

  # A Redo posts to GitHub only by the same rule that warned the grader (UX-1).
  # Read before any lock: it may look up the repository binding.
  def prepare(grade)
    @redo_issue_route = grade == "R" ? GithubIssueService.redo_issue_route(submission) : nil
    self
  end

  # `evaluate_completion: false` lets a batch evaluate each enrollment's course
  # completion once, after every one of its grades is written.
  def record!(grade:, feedback:, grading_scale:, criterion_results: nil, suggestion_decision: nil,
    override_reason_provided: false, override_reason: nil, evaluate_completion: true)
    enrollment = submission.enrollment
    redo_grade = grade == "R"
    submission.update!(grade: grade, feedback: feedback, graded_by_id: @grader.id, graded_at: Time.current)

    unless criterion_results.nil?
      submission.submission_criterion_results.destroy_all
      criterion_results.each { |result| submission.submission_criterion_results.create!(result) }
    end

    progress = Progress.find_or_initialize_by(enrollment: enrollment, user_id: submission.user_id, content_block_id: submission.content_block_id)
    progress.update!(status: redo_grade ? :in_progress : :completed)
    ActivityEvent.record!(event_type: "submission_graded", actor: @grader,
      subject_user: submission.user, cohort: enrollment&.cohort, record: submission)
    CourseCompletion.evaluate!(enrollment, actor: @grader) if evaluate_completion && !redo_grade

    if @suggestions_enabled
      record_suggestion_decision!(grading_scale: grading_scale, grade: grade, requested_decision: suggestion_decision,
        override_reason_provided: override_reason_provided, override_reason: override_reason)
    end

    if @use_v2_issue_delivery && (!redo_grade || @redo_issue_route == :v2)
      GithubIssueDeliveryPlanner.record!(submission: submission, grade: submission.grade, feedback: submission.feedback)
    elsif @use_v2_issue_delivery && redo_grade
      # This Redo stays in Learn; an earlier queued Redo (with older feedback) must not
      # post later if the repository is verified after all.
      GithubIssueDeliveryPlanner.obsolete_pending!(enrollment_id: submission.enrollment_id, content_block_id: submission.content_block_id)
    end
    submission
  end

  def deliver!
    submission.association(:submission_grade_suggestion).reset if @suggestions_enabled
    redo_grade = submission.grade == "R"
    if redo_grade
      NotificationEmailService.send_redo_notification(user: submission.user, submission: submission, feedback: submission.feedback)
    end

    SubmissionNotificationJob.perform_later("graded", submission.id, submission.graded_at.iso8601(6))

    if @use_v2_issue_delivery
      submission.association(:github_issue_deliveries).reset
    else
      token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
      if token.present? && (!redo_grade || @redo_issue_route == :legacy)
        GithubIssueService.handle_grade(submission: submission, grade: submission.grade, feedback: submission.feedback, token: token)
        submission.reload
      end
    end
    submission
  end

  private

  def record_suggestion_decision!(grading_scale:, grade:, requested_decision:, override_reason_provided:, override_reason:)
    suggestion = SubmissionGradeSuggestion.lock.find_by(submission_id: submission.id)
    if suggestion.nil?
      if requested_decision.present? && requested_decision != "dismissed"
        raise InvalidSuggestionDecision, "Suggestion decision does not match the saved grade and suggestion state."
      end
      return
    end

    active_policy = ExerciseCheckPolicy.active.find_by(content_block_id: submission.content_block_id)
    stale = suggestion.stale_for?(
      active_policy: active_policy,
      latest_submission_id: submission.id,
      submission_commit_sha: submission.commit_sha,
      grading_scale: grading_scale
    )

    computed_decision = if stale
      nil
    elsif (suggested = SubmissionGradeSuggestion::GRADE_FOR_OUTCOME[suggestion.outcome])
      grade == suggested ? "accepted" : "overridden"
    elsif suggestion.outcome == "review_for_redo"
      grade == "R" ? "accepted" : "overridden"
    end

    if requested_decision.present? && requested_decision != "dismissed" && requested_decision != computed_decision
      raise InvalidSuggestionDecision, "Suggestion decision does not match the saved grade and suggestion state."
    end

    timestamp = submission.graded_at || Time.current

    if stale && requested_decision != "dismissed"
      if suggestion.decision.present?
        archived_evidence = (suggestion.evidence || {}).deep_dup
        archived_evidence["prior_decision"] = {
          "decision" => suggestion.decision,
          "override_reason" => suggestion.override_reason,
          "decided_by_id" => suggestion.decided_by_id,
          "decided_at" => suggestion.decided_at&.iso8601(6),
          "prior_outcome" => suggestion.outcome,
          "prior_suggested_grade" => suggestion.suggested_grade,
          "prior_reason_code" => suggestion.reason_code,
          "prior_policy_version" => suggestion.policy_version,
          "prior_commit_sha" => suggestion.commit_sha,
          "superseded_at" => timestamp.iso8601(6)
        }
        suggestion.update!(evidence: archived_evidence, decision: nil, override_reason: nil, decided_by_id: nil, decided_at: nil)
      end
      return
    end

    decision = requested_decision == "dismissed" ? "dismissed" : computed_decision
    return unless decision

    reason = if decision == "accepted"
      nil
    elsif override_reason_provided
      override_reason
    elsif %w[overridden dismissed].include?(suggestion.decision)
      suggestion.override_reason
    end

    suggestion.update!(decision: decision, override_reason: reason, decided_by_id: @grader.id, decided_at: timestamp)
  end
end

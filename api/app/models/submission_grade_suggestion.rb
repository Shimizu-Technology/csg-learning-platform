class SubmissionGradeSuggestion < ApplicationRecord
  OUTCOMES = %w[suggest_b suggest_pass review_for_redo no_suggestion stale_evidence].freeze
  # Passing checks suggest B on an A / B / C curriculum and Pass on a Pass / Redo
  # one (Curriculum#grading_scale). Each suggesting outcome names its one grade.
  GRADE_FOR_OUTCOME = { "suggest_b" => "B", "suggest_pass" => "P" }.freeze
  SUGGESTED_GRADES = GRADE_FOR_OUTCOME.values.freeze
  DECISIONS = %w[accepted overridden dismissed].freeze
  MAX_OVERRIDE_REASON_LENGTH = 500
  CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/
  REASON_CODES = %w[
    all_required_checks_passed
    required_check_failed
    missing_policy
    unverified_revision
    missing_required_check
    check_pending
    check_inconclusive
    untrusted_producer
    workflow_tampered
    branch_mismatch
    stale_sha
    stale_policy
    superseded_submission
  ].freeze

  belongs_to :submission
  belongs_to :enrollment
  belongs_to :content_block
  belongs_to :exercise_check_policy, optional: true
  belongs_to :decided_by, class_name: "User", optional: true

  validates :submission_id, uniqueness: true
  validates :outcome, presence: true, inclusion: { in: OUTCOMES }
  validates :suggested_grade, inclusion: { in: SUGGESTED_GRADES }, allow_nil: true
  validates :reason_code, presence: true, inclusion: { in: REASON_CODES }
  validates :reason_summary, presence: true
  validates :evaluated_at, presence: true
  validates :policy_version, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :decision, inclusion: { in: DECISIONS }, allow_nil: true
  validates :override_reason, length: { maximum: MAX_OVERRIDE_REASON_LENGTH }, allow_nil: true
  validate :suggested_grade_matches_outcome
  validate :evidence_must_be_object
  validate :override_reason_must_not_contain_control_characters

  # True when the active policy on the exercise has changed since this
  # suggestion was evaluated (added, replaced by a new version, or deactivated).
  def stale_policy?(current_active_policy = :unloaded)
    active = current_active_policy == :unloaded ? content_block&.active_exercise_check_policy : current_active_policy
    if exercise_check_policy_id.nil?
      active.present?
    else
      active.nil? || active.id != exercise_check_policy_id || active.version != policy_version
    end
  end

  # True when the suggested grade isn't on the curriculum's current scale: B after a switch to
  # Pass / Redo, or Pass after a switch back to A / B / C / Redo. Such a suggestion is out of
  # date everywhere (serialization, the queue's filters and the grade save's decision).
  def off_scale?(current_grading_scale = :unloaded)
    expected = GRADE_FOR_OUTCOME[outcome]
    return false unless expected

    scale = current_grading_scale == :unloaded ? submission&.grading_scale : current_grading_scale
    !Curriculum.grades_for_scale(scale).include?(expected)
  end

  def stale_for?(active_policy: :unloaded, latest_submission_id: :unloaded, submission_commit_sha: :unloaded, grading_scale: :unloaded)
    outcome == "stale_evidence" ||
      off_scale?(grading_scale) ||
      stale_policy?(active_policy) ||
      (latest_submission_id != :unloaded && latest_submission_id.present? && latest_submission_id != submission_id) ||
      (submission_commit_sha != :unloaded && submission_commit_sha.present? && commit_sha.present? && !commit_sha.casecmp?(submission_commit_sha))
  end

  def to_staff_json(active_policy: :unloaded, latest_submission_id: :unloaded, submission_commit_sha: :unloaded, grading_scale: :unloaded)
    stale_policy = stale_policy?(active_policy)
    stale = stale_policy || stale_for?(
      active_policy: active_policy,
      latest_submission_id: latest_submission_id,
      submission_commit_sha: submission_commit_sha,
      grading_scale: grading_scale
    )
    {
      id: id,
      submission_id: submission_id,
      enrollment_id: enrollment_id,
      content_block_id: content_block_id,
      exercise_check_policy_id: exercise_check_policy_id,
      policy_version: policy_version,
      commit_sha: commit_sha,
      outcome: outcome,
      suggested_grade: suggested_grade,
      reason_code: reason_code,
      reason_summary: reason_summary,
      evidence: evidence || {},
      evaluated_at: evaluated_at&.iso8601(6),
      stale_for_current_policy: stale_policy,
      stale: stale,
      decision: decision,
      override_reason: override_reason,
      decided_by_id: decided_by_id,
      decided_at: decided_at&.iso8601(6),
      updated_at: updated_at&.iso8601(6)
    }
  end

  private

  def suggested_grade_matches_outcome
    if (expected = GRADE_FOR_OUTCOME[outcome])
      errors.add(:suggested_grade, "must be #{expected} when outcome is #{outcome}") unless suggested_grade == expected
    elsif suggested_grade.present?
      errors.add(:suggested_grade, "must be nil unless outcome is suggest_b or suggest_pass")
    end
  end

  def evidence_must_be_object
    errors.add(:evidence, "must be a JSON object") unless evidence.is_a?(Hash)
  end

  def override_reason_must_not_contain_control_characters
    return if override_reason.nil?

    if CONTROL_CHAR_PATTERN.match?(override_reason)
      errors.add(:override_reason, "must not contain control characters")
    end
  end
end

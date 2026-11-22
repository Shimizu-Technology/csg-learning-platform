class SubmissionGradeSuggestion < ApplicationRecord
  OUTCOMES = %w[suggest_b review_for_redo no_suggestion stale_evidence].freeze
  SUGGESTED_GRADES = %w[B].freeze
  DECISIONS = %w[accepted overridden dismissed].freeze
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
  validate :suggested_grade_matches_outcome
  validate :evidence_must_be_object

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

  def to_staff_json(active_policy: :unloaded)
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
      stale_for_current_policy: stale_policy?(active_policy),
      decision: decision,
      override_reason: override_reason,
      decided_by_id: decided_by_id,
      decided_at: decided_at&.iso8601(6),
      updated_at: updated_at&.iso8601(6)
    }
  end

  private

  def suggested_grade_matches_outcome
    if outcome == "suggest_b"
      errors.add(:suggested_grade, "must be B when outcome is suggest_b") unless suggested_grade == "B"
    elsif suggested_grade.present?
      errors.add(:suggested_grade, "must be nil unless outcome is suggest_b")
    end
  end

  def evidence_must_be_object
    errors.add(:evidence, "must be a JSON object") unless evidence.is_a?(Hash)
  end
end

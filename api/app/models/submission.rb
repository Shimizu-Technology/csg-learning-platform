class Submission < ApplicationRecord
  include LearnerWorkBlockLock

  enum :grade, { A: 0, B: 1, C: 2, R: 3 }

  # Feedback that says nothing: empty, or only Unicode whitespace (NBSP, em space, ...) and
  # zero-width characters. A Redo needs feedback that isn't blank. The web and native
  # clients use the same rule (isBlankFeedback).
  BLANK_FEEDBACK = /\A[[:space:]\u200B-\u200D\u2060\uFEFF]*\z/

  def self.blank_feedback?(text)
    BLANK_FEEDBACK.match?(text.to_s)
  end
  enum :submission_type, {
    manual_complete: 0,
    text_submission: 1,
    prework_github_sync: 2,
    repo_url_submission: 3,
    repo_and_live_url_submission: 4
  }, prefix: true

  belongs_to :content_block
  belongs_to :user
  belongs_to :enrollment, optional: true
  belongs_to :grader, class_name: "User", foreign_key: :graded_by_id, optional: true
  has_many :submission_criterion_results, dependent: :destroy
  has_many :github_check_runs, dependent: :destroy
  has_many :github_issue_deliveries, dependent: :destroy

  normalizes :feedback, with: ->(feedback) { MarkdownText.normalize(feedback) }

  # The one definition of "latest attempt": per enrollment, user and block, the
  # newest created_at, with the id breaking equal timestamps. Grading, the
  # attention list and LearnerProgress all read it, so a backfilled attempt
  # (a higher id with an older created_at) is never "latest" on one surface and
  # superseded on another.
  LATEST_FIRST = Arel.sql("submissions.created_at DESC, submissions.id DESC").freeze

  # The latest attempt of each (enrollment, user, block) in the current
  # relation, as one query (a DISTINCT ON subquery inside the relation's own
  # filters).
  scope :latest_attempts, -> {
    where(id: unscope(:select, :order)
      .select("DISTINCT ON (submissions.enrollment_id, submissions.user_id, submissions.content_block_id) submissions.id")
      .order(Arel.sql("submissions.enrollment_id, submissions.user_id, submissions.content_block_id"), LATEST_FIRST))
  }

  # Enrollment locks serialize create/grade; this query must run inside that lock
  # when deciding whether a grade may be saved. IDs break equal timestamp ties.
  def latest_attempt
    Submission.where(enrollment_id: enrollment_id, user_id: user_id, content_block_id: content_block_id)
      .order(LATEST_FIRST).first
  end

  def attempt_key
    [ enrollment_id, user_id, content_block_id ]
  end

  # Resolve all attempts, including graded rows hidden by a queue filter. The
  # user key keeps historical enrollment-less records separate as well.
  def self.latest_attempt_ids_for(submissions)
    return {} if submissions.empty?

    where(enrollment_id: submissions.map(&:enrollment_id).uniq,
      user_id: submissions.map(&:user_id).uniq,
      content_block_id: submissions.map(&:content_block_id).uniq)
      .latest_attempts
      .pluck(:enrollment_id, :user_id, :content_block_id, :id)
      .to_h { |enrollment_id, user_id, content_block_id, id| [ [ enrollment_id, user_id, content_block_id ], id ] }
  end

  def effective_submission_type
    submission_type.presence || content_block.submission_type_for(enrollment)
  end

  # Validate the merged work record at the student-work API boundary. Grading or
  # importing historical records does not retroactively validate their artifacts.
  def validate_required_content
    required = case effective_submission_type
    when "text_submission" then { text: "Submission text is required" }
    when "repo_url_submission" then { repo_url: "Repository URL is required" }
    when "repo_and_live_url_submission" then { repo_url: "Repository URL is required", live_url: "Live URL is required" }
    else {}
    end
    required.each { |field, message| errors.add(field, message) if public_send(field).to_s.strip.blank? }
    errors.empty?
  end

  validates :content_block_id, presence: true
  validates :user_id, presence: true
  validates :github_repository_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validate :preserve_captured_github_revision, on: :update

  private

  def preserve_captured_github_revision
    return if github_revision_in_database.blank?

    # Grades, feedback, rubric results and issue delivery can still be saved.
    # Curriculum copies remap block ids without changing the captured evidence.
    if %w[github_revision github_repository_id text commit_sha branch github_code_url num_submissions].any? { |field| will_save_change_to_attribute?(field) }
      errors.add(:base, "Submitted GitHub source is immutable; sync changed content as a new attempt")
    end
  end
end

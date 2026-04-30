class ContentBlock < ApplicationRecord
  enum :block_type, { video: 0, text: 1, exercise: 2, code_challenge: 3, checkpoint: 4, recording: 5 }
  enum :submission_type, {
    manual_complete: 0,
    text_submission: 1,
    prework_github_sync: 2,
    repo_url_submission: 3,
    repo_and_live_url_submission: 4
  }, prefix: true

  belongs_to :lesson
  belongs_to :s3_video_uploaded_by, class_name: "User", optional: true
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy

  validates :block_type, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position) }

  REVIEW_REQUIRED_SUBMISSION_TYPES = %w[
    text_submission
    prework_github_sync
    repo_url_submission
    repo_and_live_url_submission
  ].freeze

  def exercise_like?
    exercise? || code_challenge?
  end

  def effective_submission_type(requires_github: false)
    submission_type.presence || legacy_submission_type(requires_github: requires_github)
  end

  def review_required?(requires_github: false)
    REVIEW_REQUIRED_SUBMISSION_TYPES.include?(effective_submission_type(requires_github: requires_github))
  end

  def github_sync_submission?(requires_github: false)
    effective_submission_type(requires_github: requires_github) == "prework_github_sync"
  end

  def live_url_required?(requires_github: false)
    effective_submission_type(requires_github: requires_github) == "repo_and_live_url_submission"
  end

  private

  def legacy_submission_type(requires_github: false)
    return "manual_complete" unless exercise_like?
    return "prework_github_sync" if requires_github && filename.present?
    return "text_submission" if lesson&.requires_submission?
    return "prework_github_sync" if filename.present? && lesson&.curriculum_module&.prework?

    "manual_complete"
  end
end

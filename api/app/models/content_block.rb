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
  belongs_to :rubric, optional: true
  belongs_to :s3_video_uploaded_by, class_name: "User", optional: true
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :objective_alignments, dependent: :destroy
  has_many :learning_objectives, through: :objective_alignments
  has_one :knowledge_check, dependent: :destroy

  validates :block_type, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  before_validation :normalize_video_url
  validate :video_url_is_http
  validate :rubric_matches_curriculum
  validate :rubric_change_preserves_recorded_results

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

  def student_work_block?
    exercise_like? || checkpoint?
  end

  private

  def normalize_video_url
    return if video_url.blank?

    normalized = video_url.strip
    protocol_start = normalized.index(/https?:\/\//i)
    normalized = normalized[protocol_start..] if protocol_start&.positive?
    self.video_url = normalized
  end

  def video_url_is_http
    return if video_url.blank?

    uri = URI.parse(video_url)
    return if %w[http https].include?(uri.scheme&.downcase) && uri.host.present?

    errors.add(:video_url, "must be a valid http or https URL")
  rescue URI::InvalidURIError
    errors.add(:video_url, "must be a valid http or https URL")
  end

  def rubric_matches_curriculum
    return if rubric.nil? || rubric.curriculum_id == lesson&.curriculum_module&.curriculum_id

    errors.add(:rubric, "must belong to the lesson curriculum")
  end

  def rubric_change_preserves_recorded_results
    return unless will_save_change_to_rubric_id?
    return unless submissions.joins(:submission_criterion_results).exists?

    errors.add(:rubric, "cannot be changed after criterion feedback has been recorded")
  end

  def legacy_submission_type(requires_github: false)
    return "manual_complete" unless exercise_like?
    return "prework_github_sync" if requires_github && filename.present?
    return "text_submission" if lesson&.requires_submission?
    return "prework_github_sync" if filename.present? && lesson&.curriculum_module&.prework?

    "manual_complete"
  end
end

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
  validate :stored_video_object_is_attachable, if: :will_save_change_to_s3_video_key?
  validate :type_change_preserves_learner_work, on: :update, if: :will_save_change_to_block_type?

  scope :ordered, -> { order(:position) }

  # Runs before the dependent destroys above, so a block that holds learner
  # work is never deleted along with that work (lesson and module deletes
  # included). Untouched "not started" rows carry no work and may go. The check
  # runs under lock_against_learner_writes!, so a completion can't commit
  # between the check and the delete.
  before_destroy :preserve_learner_evidence, prepend: true
  after_destroy_commit :delete_stored_video

  MAX_PER_LESSON = 20

  # Learner work and destructive block changes meet on the block row.
  #
  # - Learner writes (Progress, Submission, KnowledgeCheckAttempt saves) take
  #   FOR KEY SHARE on their block. Those don't conflict with each other or
  #   with ordinary block edits (FOR NO KEY UPDATE), so learners never queue
  #   behind one another.
  # - Deleting a block or changing its type takes FOR UPDATE, which conflicts
  #   with FOR KEY SHARE, and only then reads learner evidence. A learner write
  #   that is in flight commits first and is seen; one that starts later waits
  #   and then finds the block gone (RecordNotFound) or unchanged.
  #
  # Both are transaction-scoped row locks (no session advisory locks), so they
  # are safe behind the Neon connection pooler.
  def self.lock_for_learner_write!(id)
    return if id.nil?
    return if where(id: id).lock("FOR KEY SHARE").pick(:id)

    raise ActiveRecord::RecordNotFound.new("Couldn't find content block #{id}", name, "id", id)
  end

  # Locks the given blocks (in id order, to keep lock order stable) against
  # learner writes for the rest of the current transaction.
  def self.lock_against_learner_writes!(ids)
    ids = Array(ids).compact.map(&:to_i).uniq.sort
    return if ids.empty?

    where(id: ids).order(:id).lock("FOR UPDATE").pluck(:id)
  end

  def lock_against_learner_writes!
    self.class.lock_against_learner_writes!([ id ]) if persisted?
  end

  # Learner work recorded against each block: submissions, progress that moved
  # past "not started" or holds watch time, and retrieval-check attempts.
  # Returns { block_id => { submissions:, progress:, watched:, check_attempts: } }.
  def self.learner_evidence_for(block_ids)
    ids = Array(block_ids).compact.map(&:to_i).uniq
    return {} if ids.empty?

    progresses = Progress.where(content_block_id: ids)
    submissions = Submission.where(content_block_id: ids).group(:content_block_id).count
    progress = progresses.where(
      "progresses.status <> :not_started OR progresses.video_total_watched > 0 OR progresses.video_last_position > 0 OR progresses.watch_credit_at IS NOT NULL",
      not_started: Progress.statuses[:not_started]
    ).group(:content_block_id).count
    watched = progresses.where("progresses.video_total_watched > 0 OR progresses.video_last_position > 0 OR progresses.watch_credit_at IS NOT NULL")
      .group(:content_block_id).count
    attempts = KnowledgeCheckAttempt.joins(:knowledge_check).where(knowledge_checks: { content_block_id: ids })
      .group("knowledge_checks.content_block_id").count
    ids.index_with do |id|
      { submissions: submissions[id].to_i, progress: progress[id].to_i, watched: watched[id].to_i, check_attempts: attempts[id].to_i }
    end
  end

  def self.learner_evidence?(counts)
    counts.present? && counts.values.any?(&:positive?)
  end

  # "3 submissions, 1 retrieval-check attempt" for messages about protected work.
  def self.describe_learner_evidence(counts)
    parts = []
    parts << ActionController::Base.helpers.pluralize(counts[:submissions], "submission") if counts[:submissions].to_i.positive?
    parts << ActionController::Base.helpers.pluralize(counts[:progress], "student progress record") if counts[:progress].to_i.positive?
    parts << ActionController::Base.helpers.pluralize(counts[:check_attempts], "retrieval-check attempt") if counts[:check_attempts].to_i.positive?
    parts.join(", ")
  end

  REVIEW_REQUIRED_SUBMISSION_TYPES = %w[
    text_submission
    prework_github_sync
    repo_url_submission
    repo_and_live_url_submission
  ].freeze

  # What people see for this block: its own title, else its lesson's title.
  # Imported blocks often have no title of their own; never return a blank.
  def display_title(fallback: "your exercise")
    title.presence || lesson&.title.presence || fallback
  end

  def exercise_like?
    exercise? || code_challenge?
  end

  def effective_submission_type(requires_github: false, feature_cohort: nil)
    resolved = submission_type.presence || legacy_submission_type(requires_github: requires_github)
    if resolved == "prework_github_sync" && feature_cohort && !FeatureSwitches.for(cohort: feature_cohort)["github_sync"]
      "text_submission"
    else
      resolved
    end
  end

  def submission_type_for(enrollment)
    config = (enrollment&.cohort&.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
    effective_submission_type(requires_github: config["requires_github"] || false, feature_cohort: enrollment&.cohort)
  end

  # A video may accompany reviewed work or a retrieval check. Its watch metrics
  # must never replace the learning status recorded by that evidence.
  def evidence_controls_completion?(enrollment)
    (knowledge_check.present? && FeatureSwitches.for(cohort: enrollment&.cohort)["knowledge_checks"]) || REVIEW_REQUIRED_SUBMISSION_TYPES.include?(submission_type_for(enrollment))
  end

  def reset_video_progress!
    progresses.includes(enrollment: :cohort).find_each do |progress|
      attributes = { video_last_position: 0, video_total_watched: 0, video_duration: nil, watch_credit_at: nil, watch_credit_fraction: 0, updated_at: Time.current }
      unless evidence_controls_completion?(progress.enrollment)
        attributes.merge!(status: Progress.statuses[:not_started], completed_at: nil)
      end
      progress.update_columns(attributes)
    end
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

  # Checkpoints normally complete through a toggle or a retrieval check. A
  # checkpoint with an explicit reviewed submission type (the Python pilot's
  # weekly checkpoints) is graded work exactly like an exercise.
  def submission_checkpoint?
    checkpoint? && submission_type.present? && REVIEW_REQUIRED_SUBMISSION_TYPES.include?(submission_type) &&
      !submission_type_prework_github_sync?
  end

  def gradable_work_block?
    exercise_like? || submission_checkpoint?
  end

  private

  def preserve_learner_evidence
    lock_against_learner_writes!
    counts = self.class.learner_evidence_for([ id ])[id]
    return unless self.class.learner_evidence?(counts)

    errors.add(:base, "#{display_title(fallback: block_type.to_s.humanize)} has learner work (#{self.class.describe_learner_evidence(counts)}), so it can't be deleted")
    throw :abort
  end

  def type_change_preserves_learner_work
    lock_against_learner_writes!
    counts = self.class.learner_evidence_for([ id ])[id]
    return unless self.class.learner_evidence?(counts)

    previous = block_type_in_database.to_s.humanize
    errors.add(:block_type, "can't change: #{display_title(fallback: previous)} has learner work (#{self.class.describe_learner_evidence(counts)})")
  end

  def delete_stored_video
    S3ObjectCleanup.delete_if_unreferenced(s3_video_key)
  end

  def stored_video_object_is_attachable
    S3ObjectCleanup.validate_attachment(self, :s3_video_key)
  end

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

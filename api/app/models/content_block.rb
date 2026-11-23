class ContentBlock < ApplicationRecord
  enum :block_type, { video: 0, text: 1, exercise: 2, code_challenge: 3, checkpoint: 4, recording: 5 }
  enum :submission_type, {
    manual_complete: 0,
    text_submission: 1,
    prework_github_sync: 2,
    repo_url_submission: 3,
    repo_and_live_url_submission: 4
  }, prefix: true

  has_one :submission_audit_review, dependent: :destroy

  belongs_to :lesson
  belongs_to :rubric, optional: true
  belongs_to :s3_video_uploaded_by, class_name: "User", optional: true
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :exercise_check_policies, dependent: :destroy
  has_one :active_exercise_check_policy, -> { where(active: true) }, class_name: "ExerciseCheckPolicy"
  has_many :submission_grade_suggestions, dependent: :destroy
  has_many :objective_alignments, dependent: :destroy
  has_many :learning_objectives, through: :objective_alignments
  has_one :knowledge_check, dependent: :destroy

  validates :block_type, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  before_validation :normalize_video_url
  before_validation :clear_replaced_video_version_duration
  before_validation :establish_video_version_duration
  validate :video_versions_are_valid
  validate :authored_video_sections_fit_duration
  before_update :lock_against_learner_writes!, if: :removing_video_version_source?
  after_update_commit :cleanup_removed_video_versions
  validate :video_url_is_http
  validate :rubric_matches_curriculum
  validate :rubric_change_preserves_recorded_results
  validate :stored_video_object_is_attachable, if: :will_save_change_to_s3_video_key?
  validate :type_change_preserves_learner_work, on: :update, if: :will_save_change_to_block_type?
  validate :media_replacement_respects_watch_progress, on: :update, if: :playable_media_replaced?
  after_update :reset_watch_progress_for_replaced_media, if: :reset_watch_progress_on_save?
  after_update :deactivate_check_policies_if_non_exercise, if: :saved_change_to_block_type?

  WATCH_RESET_REQUIRED_MESSAGE = "Students have watched this video. Replace it from the web lesson editor, which asks before resetting their watch time.".freeze

  # Set by an authoring path that has asked the author first: replacing the
  # video then resets students' watch progress. Without it, a replacement on
  # a block with watch progress is refused (see
  # media_replacement_respects_watch_progress).
  attr_accessor :confirm_watch_reset

  # Set by an authoring path that already checked the new s3_video_key in
  # storage earlier in the same transaction (S3ObjectCleanup.verify_attachment),
  # so validation doesn't repeat the S3 request while block locks are held.
  attr_accessor :verified_s3_video_key, :verified_video_version_keys

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
  #
  # Lock order: every path that locks more than one block does it in
  # ascending id order, learners and authors alike, so two transactions can
  # never each hold a block the other is waiting for.
  def self.lock_for_learner_write!(id)
    return if id.nil?
    return if where(id: id).lock("FOR KEY SHARE").pick(:id)

    raise ActiveRecord::RecordNotFound.new("Couldn't find content block #{id}", name, "id", id)
  end

  # A learner transaction that writes work on several blocks (GitHub sync, for
  # one) takes all its block locks up front, in id order, before touching any
  # learner row. Later per-row locks (LearnerWorkBlockLock) are then already
  # held. Returns the ids that still exist; a deleted block is left out.
  def self.lock_for_learner_writes!(ids)
    ids = Array(ids).compact.map(&:to_i).uniq.sort
    return [] if ids.empty?

    where(id: ids).order(:id).lock("FOR KEY SHARE").pluck(:id)
  end

  # Locks the given blocks (in id order, to keep lock order stable) against
  # learner writes for the rest of the current transaction.
  def self.lock_against_learner_writes!(ids)
    ids = Array(ids).compact.map(&:to_i).uniq.sort
    return [] if ids.empty?

    where(id: ids).order(:id).lock("FOR UPDATE").pluck(:id)
  end

  # An author's save locks every block it writes, in one ascending id pass.
  # Blocks being deleted, changing type, losing a retrieval check or getting
  # new media take FOR UPDATE, so learner writes wait and the evidence read
  # afterwards is exact. Every other block takes FOR NO KEY UPDATE: it still
  # serializes with other authors but not with learners' FOR KEY SHARE, so
  # watch pings and submissions on ordinary blocks never wait for the save.
  def self.lock_for_authoring!(ids, exclusive: [])
    exclusive = Array(exclusive).map(&:to_i).to_set
    ids = (Array(ids).compact.map(&:to_i) + exclusive.to_a).uniq.sort
    ids.chunk_while { |a, b| exclusive.include?(a) == exclusive.include?(b) }.each do |run|
      where(id: run).order(:id).lock(exclusive.include?(run.first) ? "FOR UPDATE" : "FOR NO KEY UPDATE").pluck(:id)
    end
  end

  # Trims a pasted link and drops anything typed before its http(s)://.
  def self.normalized_video_url(url)
    return url if url.blank?

    normalized = url.to_s.strip
    protocol_start = normalized.index(/https?:\/\//i)
    protocol_start&.positive? ? normalized[protocol_start..] : normalized
  end

  # What a learner actually plays: the hosted upload when there is one,
  # otherwise the linked URL.
  def self.playable_media(s3_video_key, video_url)
    s3_video_key.presence || normalized_video_url(video_url).presence
  end

  def playable_media_replaced?
    return false unless persisted?

    before = self.class.playable_media(s3_video_key_in_database, video_url_in_database)
    before.present? && before != self.class.playable_media(s3_video_key, video_url)
  end

  def lock_against_learner_writes!
    self.class.lock_against_learner_writes!([ id ]) if persisted?
  end

  # Learner work recorded against each block: submissions, progress that moved
  # past "not started" or holds watch time, and retrieval-check attempts.
  # Returns { block_id => { submissions:, progress:, watched:, check_attempts: } }.
  # `enrollment_ids` (an id list or subquery) limits the counts to those
  # enrollments, for a viewer who may not count other cohorts' work
  # (StaffCohortScope). Without it, every learner's work counts: the write
  # paths that protect learner work always use the unscoped counts.
  def self.learner_evidence_for(block_ids, enrollment_ids: nil)
    ids = Array(block_ids).compact.map(&:to_i).uniq
    return {} if ids.empty?

    scoped = ->(relation) { enrollment_ids.nil? ? relation : relation.where(enrollment_id: enrollment_ids) }
    progresses = scoped.call(Progress.where(content_block_id: ids))
    submissions = scoped.call(Submission.where(content_block_id: ids)).group(:content_block_id).count
    progress = progresses.where(
      "progresses.status <> :not_started OR progresses.video_total_watched > 0 OR progresses.video_last_position > 0 OR progresses.watch_credit_at IS NOT NULL",
      not_started: Progress.statuses[:not_started]
    ).group(:content_block_id).count
    watched = progresses.where("progresses.video_total_watched > 0 OR progresses.video_last_position > 0 OR progresses.watch_credit_at IS NOT NULL")
      .group(:content_block_id).count
    attempts = scoped.call(KnowledgeCheckAttempt.joins(:knowledge_check).where(knowledge_checks: { content_block_id: ids }))
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

  # Pass `school:` (FeatureSwitches.school) when resolving many blocks.
  def effective_submission_type(requires_github: false, feature_cohort: nil, school: nil)
    resolved = submission_type.presence || legacy_submission_type(requires_github: requires_github)
    if resolved == "prework_github_sync" && feature_cohort && !FeatureSwitches.for(cohort: feature_cohort, school: school)["github_sync"]
      "text_submission"
    else
      resolved
    end
  end

  def submission_type_for(enrollment, school: nil)
    config = (enrollment&.cohort&.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
    effective_submission_type(requires_github: config["requires_github"] || false, feature_cohort: enrollment&.cohort, school: school)
  end

  # A video may accompany reviewed work or a retrieval check. Its watch metrics
  # must never replace the learning status recorded by that evidence.
  def evidence_controls_completion?(enrollment)
    (knowledge_check.present? && FeatureSwitches.for(cohort: enrollment&.cohort)["knowledge_checks"]) || REVIEW_REQUIRED_SUBMISSION_TYPES.include?(submission_type_for(enrollment))
  end

  def reset_video_progress!
    progresses.includes(enrollment: :cohort).find_each do |progress|
      attributes = { video_last_position: 0, video_total_watched: 0, video_duration: nil, completed_video_sections: {}, watch_credit_at: nil, watch_credit_fraction: 0, updated_at: Time.current }
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

  # The legacy source remains the block's watch-credit anchor. Old clients use
  # video_stream without a version id and receive the first version as well.
  def video_versions
    value = metadata.to_h["video_versions"]
    value.is_a?(Array) ? value : []
  end

  def video_version_keys(value = metadata)
    Array(value.to_h["video_versions"]).filter_map { |item| item["s3_video_key"] if item.is_a?(Hash) }.uniq
  end

  def removing_video_version_source?(new_metadata = metadata)
    (video_version_keys(metadata_in_database) - video_version_keys(new_metadata)).any?
  end

  def author_video_sections(raw_sections)
    @authored_video_sections = VideoSegmentSet.normalize_for_authoring(raw_sections)
    self.metadata = metadata.to_h.merge(
      "video_segments" => @authored_video_sections,
      "video_segments_version" => VideoSegmentSet::CURRENT_VERSION,
      "video_segments_review_method" => "staff_authored",
      "video_segments_reviewed_at" => Date.current.iso8601
    )
  end

  private

  def authored_video_sections_fit_duration
    return unless @authored_video_sections && s3_video_key.present? && s3_video_duration_seconds.to_i.positive?

    # Only the hosted anchor has a stored duration. Equivalent versions share
    # its section timeline, and staff must check any shorter alternate.
    @authored_video_sections.each do |section|
      next if section.fetch("end_seconds") <= s3_video_duration_seconds

      errors.add(:base, "Recording section \"#{section.fetch('label')}\" must end at or before the recording duration (#{s3_video_duration_seconds} seconds)")
    end
  end

  def clear_replaced_video_version_duration
    return unless persisted? && will_save_change_to_s3_video_key?

    self.metadata = metadata.to_h.except("video_versions_duration_seconds")
  end

  def establish_video_version_duration
    return if video_versions.empty? || s3_video_duration_seconds.present?

    seconds = metadata.to_h["video_versions_duration_seconds"]
    self.s3_video_duration_seconds = seconds if seconds.is_a?(Integer) && seconds.between?(1, 28_800)
  end

  def video_versions_are_valid
    raw = metadata.to_h["video_versions"]
    return if raw.nil? || raw == []

    unless (video? || recording?) && s3_video_key.present? && raw.is_a?(Array) && raw.length.between?(1, 8)
      errors.add(:metadata, "video versions need a hosted video block and between 1 and 8 versions")
      return
    end
    unless s3_video_duration_seconds.to_i.positive?
      errors.add(:metadata, "set the original video duration before adding versions")
    end
    ids = []
    raw.each do |item|
      unless item.is_a?(Hash) && item["id"].is_a?(String) && item["id"].match?(/\A[a-zA-Z0-9_-]{1,80}\z/) &&
          item["label"].is_a?(String) && item["label"].strip.length.between?(1, 40) && S3ObjectCleanup.managed_key?(item["s3_video_key"])
        errors.add(:metadata, "each video version needs a unique id, short label and managed video upload")
        next
      end
      ids << item["id"]
      next unless will_save_change_to_metadata?
      next if video_version_keys(metadata_in_database).include?(item["s3_video_key"]) || item["s3_video_key"] == s3_video_key
      next if verified_video_version_keys&.include?(item["s3_video_key"]) && ApplicationRecord.connection.transaction_open?

      problem = ApplicationRecord.transaction { S3ObjectCleanup.verify_attachment(item["s3_video_key"]) }
      errors.add(:metadata, "video version #{problem}") if problem
    end
    errors.add(:metadata, "video version ids must be unique") if ids.uniq.length != ids.length
    if persisted? && will_save_change_to_s3_video_key?
      errors.add(:metadata, "remove video versions before replacing the underlying video")
    end
  end

  def cleanup_removed_video_versions
    return unless previous_changes.key?("metadata")

    old = previous_changes["metadata"].first
    (video_version_keys(old) - video_version_keys).each { |key| S3ObjectCleanup.delete_if_unreferenced(key) }
  end

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
    ([ s3_video_key ] + video_version_keys).compact.uniq.each { |key| S3ObjectCleanup.delete_if_unreferenced(key) }
  end

  def stored_video_object_is_attachable
    S3ObjectCleanup.validate_attachment(self, :s3_video_key, verified_key: verified_s3_video_key)
  end

  # Watch progress belongs to the media it was earned on. Carrying it over to
  # replacement media would let old credit complete a video nobody watched,
  # so a replacement on a block with student progress either resets it (the
  # author confirmed) or is refused. The block is locked first, so a watch
  # ping can't land between this check and the reset.
  def media_replacement_respects_watch_progress
    @reset_watch_progress_on_save = false
    lock_against_learner_writes!
    return unless self.class.learner_evidence_for([ id ])[id][:progress].positive?

    if ActiveModel::Type::Boolean.new.cast(confirm_watch_reset) == true
      @reset_watch_progress_on_save = true
    else
      errors.add(:base, WATCH_RESET_REQUIRED_MESSAGE)
    end
  end

  def reset_watch_progress_on_save?
    @reset_watch_progress_on_save == true
  end

  def reset_watch_progress_for_replaced_media
    @reset_watch_progress_on_save = false
    reset_video_progress!
  end

  def deactivate_check_policies_if_non_exercise
    return if exercise_like?

    exercise_check_policies.active.update_all(active: false, updated_at: Time.current)
  end

  def normalize_video_url
    return if video_url.blank?

    self.video_url = self.class.normalized_video_url(video_url)
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

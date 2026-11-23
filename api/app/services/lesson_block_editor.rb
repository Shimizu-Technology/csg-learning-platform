# Saves the block lesson editor (web, W5) as one unit: lesson settings, every
# block in order, removed blocks and objective alignments commit together or
# not at all.
#
# Data safety rules:
# - Block identity is stable. Reordering only rewrites positions; a block is
#   never deleted and recreated, so progress, submissions, watch credit and
#   next-step answers keep pointing at the same row.
# - Every existing block must be listed, either in `blocks` or in
#   `removed_block_ids`. A stale or partial client can't drop blocks by
#   leaving them out.
# - A block with learner work can't be removed or change type, and a check
#   with attempts can't be removed. Replacing a video (hosted upload or link)
#   that students have progress on resets that progress, so it needs the
#   block's id in `confirm_watch_reset_block_ids` (ContentBlock refuses it
#   otherwise, on every path).
# - `base_updated_at` must match the lesson's current version (optimistic
#   lock); the lesson row is locked while the save runs, and every other path
#   that changes blocks also advances that version (Lesson#with_authoring_lock).
# - A change to the lesson's day is held to LessonMove's learner-access rule
#   (LessonAccessImpact): it is refused when a learner with work in the
#   lesson could no longer open it on the new day.
# - Locks, in order: new video keys are checked in storage first, with no row
#   locked; then, for a day change only, the curriculum FOR UPDATE (before the
#   caller's access re-check, which takes it FOR SHARE) and after that re-check
#   the lesson's module, as LessonMove does; then the lesson row; then every
#   block in one ascending id pass (ContentBlock.lock_for_authoring!). Only
#   blocks being removed, changing type, losing a retrieval check or getting
#   new media (or every block, for a day change) are locked against learner
#   writes, and their learner work is counted after that lock, so a
#   completion can't land between the check and the change. Ordinary edits
#   don't make learners wait.
class LessonBlockEditor
  class Stale < StandardError; end

  class Invalid < StandardError
    attr_reader :code, :block_ids, :completion_impact

    def initialize(message, code: "invalid", block_ids: nil, completion_impact: nil)
      super(message)
      @code = code
      @block_ids = block_ids
      @completion_impact = completion_impact
    end
  end

  VIDEO_TYPES = %w[video recording].freeze
  TEXT_FIELDS = %w[title body solution filename video_url].freeze

  # Returns the lesson.requires_submission value LessonBlockEditor persists for
  # a lesson's blocks. An exercise or code challenge with submission_type: nil
  # inherits its effective submission type from lesson.requires_submission
  # (ContentBlock#legacy_submission_type), so keep the legacy lesson flag
  # unchanged while any such block exists.
  def self.derived_requires_submission(lesson)
    primary = lesson.primary_assignment_block
    return lesson.requires_submission unless primary&.submission_type.present?
    return lesson.requires_submission if lesson.content_blocks.any? { |block| block.exercise_like? && block.submission_type.nil? }

    ContentBlock::REVIEW_REQUIRED_SUBMISSION_TYPES.include?(primary.submission_type)
  end

  # before_lock runs inside the transaction after the storage checks and
  # before the lesson row is locked (the controller re-checks editing access
  # there; see LessonEditAccess).
  def initialize(lesson:, params:, user:, before_lock: nil)
    @before_lock = before_lock
    @lesson = lesson
    @params = params.to_h.with_indifferent_access
    @user = user
    @client_ids = {}
    @released_video_keys = []
  end

  def save!
    ApplicationRecord.transaction do
      # S3 answers before any row is locked; the key's advisory lock is held
      # to commit so a cleanup can't delete the object in between.
      verify_new_video_keys!
      day_change = day_change_requested?
      Curriculum.lock_for_content!(@lesson.curriculum_module.curriculum_id, "FOR UPDATE") if day_change
      @before_lock&.call
      CurriculumModule.where(id: @lesson.module_id).lock.pluck(:id) if day_change
      @lesson.with_authoring_lock do
        require_current_version!
        # Authoring changes are serialized by the lesson lock, so these block
        # rows can't change type or media under us before they're locked.
        @existing = @lesson.content_blocks.reload.includes(knowledge_check: :attempts).index_by(&:id)
        validate_block_list!
        guarded = guarded_block_ids
        # A day change counts learner work across the whole lesson.
        guarded |= @existing.keys if day_change || adds_completion_block?
        # Learner writes on guarded blocks wait while this save runs, so the
        # evidence read below stays true until commit.
        ContentBlock.lock_for_authoring!(@existing.keys, exclusive: guarded)
        @evidence = ContentBlock.learner_evidence_for(guarded)
        require_reopen_confirmation!
        remove_blocks!
        save_blocks!
        save_lesson!
        replace_alignments! if @params.key?(:alignments)
      end
    end
    @released_video_keys.uniq.each { |key| S3ObjectCleanup.delete_if_unreferenced(key) }
    @lesson
  rescue ActiveRecord::RecordInvalid => error
    raise Invalid.new(error.record.errors.full_messages.to_sentence.presence || error.message)
  rescue ActiveRecord::RecordNotDestroyed => error
    raise Invalid.new(error.record.errors.full_messages.to_sentence.presence || "A block couldn't be removed", code: "learner_data")
  rescue ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout
    raise Invalid.new("Students were saving work in this lesson at the same moment, so nothing was saved. Save again.", code: "retry")
  end

  private

  def adds_completion_block?
    block_payloads.any? { |payload| payload[:id].blank? && %w[exercise code_challenge checkpoint].include?(payload[:block_type].to_s) }
  end

  def require_reopen_confirmation!
    return unless adds_completion_block?

    impact = LessonCompletionImpact.for_lesson(@lesson, viewer: @user)
    return if impact[:completed_learners].zero?
    return if @params[:confirm_reopen_completed_count].to_s == impact[:completed_learners].to_s

    raise Invalid.new("Adding this work reopens the lesson for #{impact[:completed_learners]} learners until they finish the new work.",
      code: "confirm_reopen_completed", completion_impact: impact)
  end

  def require_current_version!
    requested = @params[:base_updated_at].presence
    raise Stale if requested.blank?
    raise Stale unless Time.iso8601(requested) == @lesson.updated_at
  rescue ArgumentError
    raise Stale
  end

  # Read before any lock. The version check under the lesson lock refuses a
  # save whose lesson changed since, so this answer holds when it matters.
  def day_change_requested?
    return false unless @params.key?(:release_day)

    Integer(@params[:release_day].to_s, 10) != @lesson.release_day
  rescue ArgumentError, TypeError
    false
  end

  def block_payloads
    @block_payloads ||= Array(@params[:blocks]).map { |block| block.to_h.with_indifferent_access }
  end

  def removed_ids
    @removed_ids ||= Array(@params[:removed_block_ids]).map { |id| Integer(id.to_s, 10) }
  rescue ArgumentError, TypeError
    raise Invalid.new("removed_block_ids must be block ids")
  end

  def verify_new_video_keys!
    current = @lesson.content_blocks.pluck(:id, :s3_video_key).to_h
    keys = block_payloads.filter_map do |payload|
      key = payload[:s3_video_key].presence if payload.key?(:s3_video_key)
      next if key.nil?
      next if payload[:id].present? && current[payload[:id].to_i] == key

      key.to_s
    end
    keys += block_payloads.flat_map do |payload|
      Array(payload.dig(:metadata, :video_versions)).filter_map { |item| item[:s3_video_key].presence if item.is_a?(Hash) }
    end
    @verified_video_keys = Set.new
    # Sorted so writers that verify several keys (LessonDuplicate too) take
    # their advisory locks in the same order.
    keys.uniq.sort.each do |key|
      problem = S3ObjectCleanup.verify_attachment(key)
      raise Invalid.new("S3 video key #{problem}") if problem

      @verified_video_keys << key
    end
  end

  # Blocks whose learner work decides whether the save may go ahead.
  def guarded_block_ids
    @guarded_media_ids = Set.new
    ids = removed_ids.dup
    block_payloads.each do |payload|
      next if payload[:id].blank?

      block = @existing.fetch(payload[:id].to_i)
      ids << block.id if payload[:block_type].to_s != block.block_type
      ids << block.id if block.knowledge_check && payload[:knowledge_check].blank?
      if payload[:metadata].is_a?(Hash) && payload[:metadata].key?(:video_versions) &&
          block.removing_video_version_source?(payload[:metadata].stringify_keys)
        ids << block.id
      end
      if media_replaced?(block, payload)
        ids << block.id
        @guarded_media_ids << block.id
      end
    end
    ids.uniq
  end

  def media_replaced?(block, payload)
    key = payload.key?(:s3_video_key) ? payload[:s3_video_key].presence : block.s3_video_key
    url = payload.key?(:video_url) ? payload[:video_url] : block.video_url
    before = ContentBlock.playable_media(block.s3_video_key, block.video_url)
    before.present? && before != ContentBlock.playable_media(key, url)
  end

  def confirmed_watch_resets
    @confirmed_watch_resets ||= Array(@params[:confirm_watch_reset_block_ids]).map(&:to_i).to_set
  end

  def validate_block_list!
    count = block_payloads.length
    unless count.between?(1, ContentBlock::MAX_PER_LESSON)
      raise Invalid.new("A lesson needs between 1 and #{ContentBlock::MAX_PER_LESSON} blocks")
    end

    listed = block_payloads.filter_map { |payload| payload[:id].presence&.to_i }
    all_ids = listed + removed_ids
    raise Invalid.new("A block is listed more than once") if all_ids.uniq.length != all_ids.length

    unknown = all_ids - @existing.keys
    raise ActiveRecord::RecordNotFound, "Couldn't find content block #{unknown.first} in this lesson" if unknown.any?

    missing = @existing.keys - all_ids
    if missing.any?
      raise Invalid.new("This save doesn't account for every block in the lesson. Reload the lesson and try again.", code: "blocks_mismatch")
    end

    client_ids = block_payloads.filter_map { |payload| payload[:client_id].presence if payload[:id].blank? }
    raise Invalid.new("Each new block needs its own client_id") if client_ids.uniq.length != client_ids.length

    block_payloads.each do |payload|
      next if ContentBlock.block_types.key?(payload[:block_type].to_s)

      raise Invalid.new("block_type must be one of #{ContentBlock.block_types.keys.join(', ')}")
    end
  end

  def evidence_for(block)
    @evidence[block.id] || {}
  end

  def remove_blocks!
    removed_ids.each do |id|
      block = @existing.fetch(id)
      counts = evidence_for(block)
      if ContentBlock.learner_evidence?(counts)
        raise Invalid.new(
          "\"#{block.display_title(fallback: block.block_type.humanize)}\" has learner work (#{ContentBlock.describe_learner_evidence(counts)}), so it can't be deleted. Keep the block, or archive the whole lesson.",
          code: "learner_data"
        )
      end
      @released_video_keys << block.s3_video_key if block.s3_video_key.present?
      block.destroy!
    end
  end

  def save_blocks!
    block_payloads.each_with_index do |payload, index|
      block = if payload[:id].present?
        update_existing_block(@existing.fetch(payload[:id].to_i), payload)
      else
        @lesson.content_blocks.new(block_type: payload[:block_type])
      end
      assign_block_fields(block, payload, position: index)
      require_watch_reset_confirmation!(block)
      block.confirm_watch_reset = confirmed_watch_resets.include?(block.id)
      block.verified_s3_video_key = block.s3_video_key if @verified_video_keys.include?(block.s3_video_key)
      block.verified_video_version_keys = @verified_video_keys
      old_key = block.s3_video_key_in_database
      key_changed = block.will_save_change_to_s3_video_key?
      # A confirmed replacement resets watch progress in ContentBlock.
      block.save!
      save_knowledge_check!(block, payload)

      @released_video_keys << old_key if key_changed && old_key.present?
      @client_ids[payload[:client_id].to_s] = block.id if payload[:id].blank? && payload[:client_id].present?
    end
  end

  def update_existing_block(block, payload)
    if payload[:block_type].to_s != block.block_type && ContentBlock.learner_evidence?(evidence_for(block))
      raise Invalid.new(
        "\"#{block.display_title(fallback: block.block_type.humanize)}\" has learner work (#{ContentBlock.describe_learner_evidence(evidence_for(block))}), so its type can't change.",
        code: "learner_data"
      )
    end
    block.block_type = payload[:block_type]
    block
  end

  def assign_block_fields(block, payload, position:)
    attributes = payload.slice(*TEXT_FIELDS).transform_values { |value| value.is_a?(String) ? value : value&.to_s }
    block.assign_attributes(attributes)
    block.position = position
    if payload.key?(:submission_type)
      type = payload[:submission_type].presence
      raise Invalid.new("submission_type must be one of #{ContentBlock.submission_types.keys.join(', ')}") if type && !ContentBlock.submission_types.key?(type)

      block.submission_type = type
    end
    block.submission_config = payload[:submission_config].to_h if payload.key?(:submission_config)
    block.rubric_id = payload[:rubric_id].presence if payload.key?(:rubric_id)
    if payload[:metadata].is_a?(Hash)
      block.metadata = payload[:metadata] if block.new_record?
      editable = payload[:metadata].slice(:video_versions, :video_versions_duration_seconds, :final_project)
      block.metadata = block.metadata.to_h.merge(editable.stringify_keys) if editable.present?
    end
    if payload.key?(:video_segments)
      block.metadata = (block.metadata || {}).merge(
        "video_segments" => VideoSegmentSet.normalize(Array(payload[:video_segments])),
        "video_segments_version" => VideoSegmentSet::CURRENT_VERSION,
        "video_segments_review_method" => "staff_authored",
        "video_segments_reviewed_at" => Date.current.iso8601
      )
    end
    assign_video_key(block, payload) if payload.key?(:s3_video_key)
  end

  # Same rule ContentBlock enforces, asked here first so the editor gets a
  # message it can turn into a confirmation (and which blocks need it).
  def require_watch_reset_confirmation!(block)
    return unless block.persisted? && block.playable_media_replaced?
    return if confirmed_watch_resets.include?(block.id)

    students = evidence_for(block)[:progress].to_i
    return unless students.positive?

    pending = block_payloads.filter_map do |payload|
      existing = payload[:id].present? && @existing[payload[:id].to_i]
      existing.id if existing && @guarded_media_ids.include?(existing.id) && !confirmed_watch_resets.include?(existing.id) && evidence_for(existing)[:progress].to_i.positive?
    end
    raise Invalid.new(
      "Replacing the video in \"#{block.display_title(fallback: 'this block')}\" resets watch progress for #{ActionController::Base.helpers.pluralize(students, 'student')}. Confirm the reset to save.",
      code: "confirm_watch_reset",
      block_ids: pending
    )
  end

  def assign_video_key(block, payload)
    key = payload[:s3_video_key].presence
    return if key == block.s3_video_key

    block.s3_video_key = key
    if key
      content_type = payload[:s3_video_content_type].to_s.strip
      size = Integer(payload[:s3_video_size].to_s, 10, exception: false)
      raise Invalid.new("Hosted video uploads need s3_video_content_type and s3_video_size") if content_type.blank? || size.nil?
      raise Invalid.new("s3_video_content_type must be a video/* MIME type") unless content_type.match?(ApplicationController::VIDEO_MIME_PATTERN)
      raise Invalid.new("s3_video_size must be between 1 byte and 5 GB") unless size.between?(1, S3Service::MAX_UPLOAD_SIZE)

      block.s3_video_content_type = content_type.downcase
      block.s3_video_size = size
      block.s3_video_uploaded_by = @user
      block.s3_video_uploaded_at = Time.current
    else
      block.s3_video_content_type = nil
      block.s3_video_size = nil
      block.s3_video_uploaded_by = nil
      block.s3_video_uploaded_at = nil
    end
    block.s3_video_duration_seconds = nil
  end

  def save_knowledge_check!(block, payload)
    check_payload = payload[:knowledge_check].presence
    check = block.knowledge_check

    if check_payload.nil?
      return unless check

      if check.attempts.exists?
        raise Invalid.new("The retrieval check in \"#{block.display_title(fallback: 'this checkpoint')}\" has student attempts, so it can't be removed.", code: "learner_data")
      end
      check.destroy!
      block.association(:knowledge_check).reset
      return
    end

    raise Invalid.new("Only checkpoint blocks can hold a retrieval check") unless block.checkpoint?

    check ||= block.build_knowledge_check
    check.assign_attributes(
      prompt: check_payload[:prompt],
      options: Array(check_payload[:options]).map { |option| option.to_s.strip },
      correct_option: check_payload[:correct_option],
      explanation: check_payload[:explanation],
      learning_objective_id: check_payload[:learning_objective_id].presence
    )
    check.save! if check.new_record? || check.has_changes_to_save?
  end

  def save_lesson!
    attributes = @params.slice(:title, :required, :release_day)
    attributes[:required] = ActiveModel::Type::Boolean.new.cast(attributes[:required]) if attributes.key?(:required)
    @lesson.content_blocks.reload
    attributes[:requires_submission] = self.class.derived_requires_submission(@lesson)
    @lesson.assign_attributes(attributes)
    require_learner_access_kept! if @lesson.will_save_change_to_release_day?
    @lesson.save!
  end

  # Same rule as LessonMove: a learner with work in the lesson must still be
  # able to open it on its new day. Runs under the locks save! took for a day
  # change, with every block locked against learner writes.
  def require_learner_access_kept!
    mod = @lesson.curriculum_module
    current = Lesson.instantiate(@lesson.attributes.merge("release_day" => @lesson.release_day_in_database))
    current.readonly!
    impact = LessonAccessImpact.new(lesson: current, source: mod, target: mod, release_day: @lesson.release_day, block_ids: @existing.keys).call
    count = impact[:learners_with_work_losing_access]
    return unless count.positive?

    raise Invalid.new(
      "#{ActionController::Base.helpers.pluralize(count, 'learner')} with work in this lesson " \
      "couldn't open it on that day: it hasn't opened for them yet, or it falls after their pause. " \
      "Keep the current day, or choose one that's already open to them.",
      code: "learner_access"
    )
  end

  def replace_alignments!
    requested = Array(@params[:alignments]).map { |alignment| alignment.to_h.with_indifferent_access }
    if requested.length > Api::V1::ObjectiveAlignmentsController::MAX_ALIGNMENTS
      raise Invalid.new("A lesson can have at most #{Api::V1::ObjectiveAlignmentsController::MAX_ALIGNMENTS} objective alignments")
    end

    @lesson.objective_alignments.destroy_all
    requested.each_with_index do |alignment, position|
      objective = LearningObjective.find(alignment.fetch(:learning_objective_id))
      block_id = if alignment[:block_client_id].present?
        @client_ids.fetch(alignment[:block_client_id].to_s) { raise Invalid.new("An objective points at a block that isn't in this save") }
      else
        alignment[:content_block_id].presence&.to_i
      end
      @lesson.objective_alignments.create!(
        learning_objective: objective,
        content_block: block_id ? @lesson.content_blocks.find(block_id) : nil,
        position: position
      )
    end
  end
end

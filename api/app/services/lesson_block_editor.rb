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
#   with attempts can't be removed. Replacing a hosted video resets watch
#   credit, so it needs the block's id in `confirm_watch_reset_block_ids`.
# - `base_updated_at` must match the lesson's current version (optimistic
#   lock); the lesson row is locked while the save runs, and every other path
#   that changes blocks also advances that version (Lesson#with_authoring_lock).
# - The lesson's blocks are locked against learner writes before learner work
#   is counted, so a completion can't land between the check and the change.
class LessonBlockEditor
  class Stale < StandardError; end

  class Invalid < StandardError
    attr_reader :code

    def initialize(message, code: "invalid")
      super(message)
      @code = code
    end
  end

  VIDEO_TYPES = %w[video recording].freeze
  TEXT_FIELDS = %w[title body solution filename video_url].freeze

  def initialize(lesson:, params:, user:)
    @lesson = lesson
    @params = params.to_h.with_indifferent_access
    @user = user
    @client_ids = {}
    @released_video_keys = []
  end

  def save!
    @lesson.with_authoring_lock do
      require_current_version!
      # Learner writes wait while this save runs, so the evidence read below
      # stays true until commit (see ContentBlock.lock_for_learner_write!).
      ContentBlock.lock_against_learner_writes!(@lesson.content_blocks.pluck(:id))
      @existing = @lesson.content_blocks.reload.includes(knowledge_check: :attempts).index_by(&:id)
      validate_block_list!
      @evidence = ContentBlock.learner_evidence_for(@existing.keys)
      remove_blocks!
      save_blocks!
      save_lesson!
      replace_alignments! if @params.key?(:alignments)
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

  def require_current_version!
    requested = @params[:base_updated_at].presence
    raise Stale if requested.blank?
    raise Stale unless Time.iso8601(requested) == @lesson.updated_at
  rescue ArgumentError
    raise Stale
  end

  def block_payloads
    @block_payloads ||= Array(@params[:blocks]).map { |block| block.to_h.with_indifferent_access }
  end

  def removed_ids
    @removed_ids ||= Array(@params[:removed_block_ids]).map { |id| Integer(id.to_s, 10) }
  rescue ArgumentError, TypeError
    raise Invalid.new("removed_block_ids must be block ids")
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
      old_key = block.s3_video_key_in_database
      key_changed = block.will_save_change_to_s3_video_key?
      block.save!
      save_knowledge_check!(block, payload)

      if key_changed && old_key.present?
        block.update_column(:s3_video_duration_seconds, nil)
        block.reset_video_progress!
        @released_video_keys << old_key
      end
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
    block.metadata = payload[:metadata].to_h if block.new_record? && payload[:metadata].is_a?(Hash)
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

  def assign_video_key(block, payload)
    key = payload[:s3_video_key].presence
    return if key == block.s3_video_key

    if block.persisted? && block.s3_video_key.present? && evidence_for(block)[:watched].to_i.positive? && !confirmed_watch_resets.include?(block.id)
      raise Invalid.new(
        "Replacing the video in \"#{block.display_title(fallback: 'this block')}\" resets watch time for #{ActionController::Base.helpers.pluralize(evidence_for(block)[:watched], 'student')}. Confirm the reset to save.",
        code: "confirm_watch_reset"
      )
    end

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
    primary = @lesson.primary_assignment_block
    if primary&.submission_type.present?
      attributes[:requires_submission] = ContentBlock::REVIEW_REQUIRED_SUBMISSION_TYPES.include?(primary.submission_type)
    end
    @lesson.update!(attributes)
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

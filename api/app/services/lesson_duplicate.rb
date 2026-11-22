# Duplicates a lesson within its module (T-12, W5 PR 5.3 part 2).
#
# Block identity rules: every block of the copy is a new row (with its own
# retrieval check and objective alignments), so no learner data is copied
# or shared. Progress, submissions, watch credit and quiz attempts stay on
# the original. Rubrics and learning objectives are curriculum-level and are
# referenced, not copied. A hosted video is shared by key; S3ObjectCleanup
# only deletes an object once no block references it.
#
# The copy starts archived, on the same day just after the original, so
# learners don't see a second identical lesson until an admin edits and
# restores it.
#
# Locks, after every hosted video key is checked in storage and in the order
# Curriculum.lock_for_content! documents: the curriculum FOR SHARE (a move,
# which takes it FOR UPDATE, finishes first or waits), then the lesson's
# module FOR SHARE (the copy is inserted there), then the original lesson
# FOR SHARE (authors' saves wait, learners don't).
#
# Video keys are verified (and their transaction-scoped advisory locks taken)
# before any row lock. An author can still replace a video between that check
# and the lesson lock. Validating the new key would then take its advisory
# lock after the lesson lock, the reverse of an editor that already holds the
# key and is waiting for the lesson, so the two would deadlock. Instead, any
# key found under the row locks that wasn't verified rolls the attempt back,
# releasing every lock, and the whole duplicate starts again from the storage
# checks (at most MAX_ATTEMPTS times).
class LessonDuplicate
  COPY_SUFFIX = " (copy)".freeze
  MAX_ATTEMPTS = 3

  # Raised inside the transaction to roll an attempt back; never escapes.
  class MediaChanged < StandardError; end

  def initialize(lesson:, user:)
    @lesson = lesson
    @user = user
  end

  def duplicate!
    attempts = 0
    begin
      attempts += 1
      duplicate_once!
    rescue MediaChanged
      retry if attempts < MAX_ATTEMPTS
      raise ActiveRecord::RecordInvalid.new(invalid_lesson("This lesson's videos kept changing while it was being copied. Try again."))
    end
  end

  private

  def duplicate_once!
    ApplicationRecord.transaction do
      # Sorted so two transactions verifying the same keys take their
      # advisory locks in the same order.
      verified = current_video_keys.to_h do |key|
        problem = S3ObjectCleanup.verify_attachment(key)
        raise ActiveRecord::RecordInvalid.new(invalid_lesson("A hosted video in this lesson #{problem}")) if problem

        [ key, true ]
      end
      Curriculum.lock_for_content!(@lesson.curriculum_module.curriculum_id)
      # Moves stay inside the curriculum and hold its lock, so the module read
      # after it is the one the lesson is in until this commits.
      module_id = Lesson.where(id: @lesson.id).pick(:module_id) || raise(ActiveRecord::RecordNotFound.new("Couldn't find Lesson", "Lesson", "id", @lesson.id))
      CurriculumModule.where(id: module_id).lock("FOR SHARE").pick(:id)
      Lesson.where(id: @lesson.id).lock("FOR SHARE").pick(:id)
      @lesson.reload
      # Never validate an unverified key here: that would take its advisory
      # lock while holding the lesson.
      raise MediaChanged if @lesson.content_blocks.any? { |block| block_video_keys(block).any? { |key| !verified[key] } }

      copy = @lesson.curriculum_module.all_lessons.create!(
        title: copy_title,
        lesson_type: @lesson.lesson_type,
        release_day: @lesson.release_day,
        position: @lesson.position,
        required: @lesson.required,
        requires_submission: @lesson.requires_submission,
        archived_at: Time.current
      )
      block_ids = {}
      @lesson.content_blocks.includes(:knowledge_check).each do |block|
        new_block = copy.content_blocks.new(
          block.attributes.except("id", "lesson_id", "created_at", "updated_at", "s3_video_uploaded_by_id", "s3_video_uploaded_at")
        )
        if block.s3_video_key.present?
          new_block.verified_s3_video_key = block.s3_video_key
          new_block.s3_video_uploaded_by_id = block.s3_video_uploaded_by_id
          new_block.s3_video_uploaded_at = block.s3_video_uploaded_at
        end
        new_block.verified_video_version_keys = verified.keys
        new_block.save!
        if (check = block.knowledge_check)
          new_block.create_knowledge_check!(check.attributes.except("id", "content_block_id", "created_at", "updated_at"))
        end
        block_ids[block.id] = new_block.id
      end
      @lesson.objective_alignments.order(:position, :id).each do |alignment|
        copy.objective_alignments.create!(
          learning_objective_id: alignment.learning_objective_id,
          content_block_id: alignment.content_block_id && block_ids.fetch(alignment.content_block_id),
          position: alignment.position
        )
      end
      copy
    end
  end

  # Read from the database, not the (possibly preloaded) association, so a
  # retry sees the video that replaced the one it couldn't use.
  def current_video_keys
    ApplicationRecord.uncached do
      ContentBlock.where(lesson_id: @lesson.id).select(:s3_video_key, :metadata).flat_map { |block| block_video_keys(block) }.uniq.sort
    end
  end

  def block_video_keys(block)
    ([ block.s3_video_key ] + block.video_version_keys).compact_blank
  end

  def copy_title
    limit = Lesson.columns_hash["title"].limit
    title = "#{@lesson.title}#{COPY_SUFFIX}"
    limit ? title.first(limit) : title
  end

  def invalid_lesson(message)
    @lesson.errors.add(:base, message)
    @lesson
  end
end

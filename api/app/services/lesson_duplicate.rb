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
# Locks: the original lesson FOR SHARE (authors' saves wait, learners
# don't), after every hosted video key is checked in storage.
class LessonDuplicate
  COPY_SUFFIX = " (copy)".freeze

  def initialize(lesson:, user:)
    @lesson = lesson
    @user = user
  end

  def duplicate!
    ApplicationRecord.transaction do
      verified = @lesson.content_blocks.filter_map(&:s3_video_key).uniq.to_h do |key|
        problem = S3ObjectCleanup.verify_attachment(key)
        raise ActiveRecord::RecordInvalid.new(invalid_lesson("A hosted video in this lesson #{problem}")) if problem

        [ key, true ]
      end
      Lesson.where(id: @lesson.id).lock("FOR SHARE").pluck(:id)
      @lesson.reload
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
          new_block.verified_s3_video_key = block.s3_video_key if verified[block.s3_video_key]
          new_block.s3_video_uploaded_by_id = block.s3_video_uploaded_by_id
          new_block.s3_video_uploaded_at = block.s3_video_uploaded_at
        end
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

  private

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

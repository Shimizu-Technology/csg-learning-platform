class LessonRecording < ApplicationRecord
  belongs_to :recording
  belongs_to :lesson

  validates :lesson_id, uniqueness: { scope: :recording_id }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :lesson_belongs_to_recording_curriculum

  private

  def lesson_belongs_to_recording_curriculum
    return unless lesson && recording&.cohort
    return if lesson.curriculum_module.curriculum_id == recording.cohort.curriculum_id

    errors.add(:lesson, "must belong to the recording cohort's curriculum")
  end
end

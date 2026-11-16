# Media totals shared by the web and native staff profile. Lesson completion
# follows LearnerProgress; class recordings keep their existing watch credit.
class StudentMediaProgress
  def initialize(enrollment:, progress:)
    @enrollment = enrollment
    @progress = progress
  end

  def call
    recordings = Recording.where(cohort_id: @enrollment.cohort_id)
    videos = @progress.lessons.flat_map(&:content_blocks).select { |block| %w[video recording].include?(block.block_type) && block.s3_video_key.present? }
    completed_recordings = WatchProgress.where(user_id: @enrollment.user_id, recording_id: recordings.select(:id), completed: true).count
    {
      recordings_completed: completed_recordings,
      recordings_total: recordings.count,
      lesson_videos_completed: videos.count { |block| @progress.block_state(block) == LearnerProgress::BlockState::COMPLETE },
      lesson_videos_total: videos.size,
      videos_completed: completed_recordings + videos.count { |block| @progress.block_state(block) == LearnerProgress::BlockState::COMPLETE }
    }
  end
end

# Summarizes what happened to a learner's reviewed work in one lesson so the
# UI can say "awaiting review" or "redo requested" instead of treating a
# submission as finished work.
module LessonReviewStatus
  AWAITING_REVIEW = "awaiting_review".freeze
  REDO_REQUESTED = "redo_requested".freeze
  REVIEWED = "reviewed".freeze

  # latest_submissions maps content_block_id to the learner's latest submission.
  def self.for(lesson, latest_submissions)
    latest = lesson.content_blocks.select(&:gradable_work_block?).filter_map { |block| latest_submissions[block.id] }
    return nil if latest.empty?
    return REDO_REQUESTED if latest.any? { |submission| submission.grade == "R" }
    return AWAITING_REVIEW if latest.any? { |submission| submission.grade.nil? }

    REVIEWED
  end
end

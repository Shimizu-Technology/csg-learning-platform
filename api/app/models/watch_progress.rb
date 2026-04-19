class WatchProgress < ApplicationRecord
  belongs_to :user
  belongs_to :recording

  validates :recording_id, uniqueness: { scope: :user_id }
  validates :last_position_seconds, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :total_watched_seconds, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  before_save :check_completion

  def progress_percentage
    return 0 unless duration_seconds&.positive?
    [ (total_watched_seconds.to_f / duration_seconds * 100).round(1), 100.0 ].min
  end

  private

  def check_completion
    return unless duration_seconds&.positive?
    return if completed?
    self.completed = total_watched_seconds >= (duration_seconds * 0.9)
  end
end

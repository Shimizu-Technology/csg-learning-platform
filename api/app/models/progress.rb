class Progress < ApplicationRecord
  enum :status, { not_started: 0, in_progress: 1, completed: 2 }

  belongs_to :user
  belongs_to :content_block
  belongs_to :enrollment, optional: true

  validates :content_block_id, uniqueness: { scope: :enrollment_id }, if: :enrollment_id?
  validates :content_block_id, uniqueness: { scope: :user_id }, unless: :enrollment_id?

  before_save :set_completed_at

  private

  def set_completed_at
    if completed? && completed_at.nil?
      self.completed_at = Time.current
    elsif !completed?
      self.completed_at = nil
    end
  end
end

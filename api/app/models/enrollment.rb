class Enrollment < ApplicationRecord
  enum :status, { active: 0, paused: 1, dropped: 2, completed: 3 }

  belongs_to :user
  belongs_to :cohort
  has_many :module_assignments, dependent: :destroy

  validates :user_id, uniqueness: { scope: :cohort_id }

  before_create :set_enrolled_at

  private

  def set_enrolled_at
    self.enrolled_at ||= Time.current
  end
end

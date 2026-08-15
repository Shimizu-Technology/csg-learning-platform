class Enrollment < ApplicationRecord
  class StaleLearningWrite < StandardError; end

  enum :status, { active: 0, paused: 1, dropped: 2, completed: 3 }

  belongs_to :user
  belongs_to :cohort
  has_many :module_assignments, dependent: :destroy
  has_many :lesson_assignments, dependent: :destroy
  has_many :interventions, dependent: :destroy
  has_many :recovery_plans, dependent: :destroy

  validates :user_id, uniqueness: { scope: :cohort_id }

  before_create :set_enrolled_at

  def with_learning_write_guard(request_started_at:)
    with_lock do
      if learning_state_reset_at.present? && request_started_at <= learning_state_reset_at
        raise StaleLearningWrite, "Your class progress was restarted while this request was in flight. Reload before saving again."
      end

      yield
    end
  end

  private

  def set_enrolled_at
    self.enrolled_at ||= Time.current
  end
end

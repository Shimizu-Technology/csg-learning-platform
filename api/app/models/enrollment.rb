class Enrollment < ApplicationRecord
  class StaleLearningWrite < StandardError; end

  enum :status, { active: 0, paused: 1, dropped: 2, completed: 3 }

  belongs_to :user
  belongs_to :cohort
  has_many :module_assignments, dependent: :destroy
  has_many :lesson_assignments, dependent: :destroy
  has_many :interventions, dependent: :destroy
  has_many :recovery_plans, dependent: :destroy
  has_many :private_meeting_bookings, dependent: :restrict_with_error

  validates :user_id, uniqueness: { scope: :cohort_id }

  before_create :set_enrolled_at
  after_create :assign_alumni_curriculum_modules, if: :active_alumni_enrollment?
  after_update :assign_alumni_curriculum_modules, if: :reactivated_alumni_enrollment?

  def with_learning_write_guard(request_started_at:)
    with_lock do
      if learning_state_reset_at.present? && request_started_at <= learning_state_reset_at
        raise StaleLearningWrite, "Your class progress was restarted while this request was in flight. Reload before saving again."
      end

      yield
    end
  end

  def ensure_alumni_curriculum_modules!
    return unless active? && cohort.alumni?

    cohort.curriculum.modules.find_each do |curriculum_module|
      assignment = module_assignments.find_or_initialize_by(curriculum_module: curriculum_module)
      assignment.unlocked = true
      assignment.unlock_date_override = nil
      assignment.save!
    end
  end

  private

  def set_enrolled_at
    self.enrolled_at ||= Time.current
  end

  def active_alumni_enrollment?
    active? && cohort.alumni?
  end

  def reactivated_alumni_enrollment?
    saved_change_to_status? && active_alumni_enrollment?
  end

  def assign_alumni_curriculum_modules
    ensure_alumni_curriculum_modules!
  end
end

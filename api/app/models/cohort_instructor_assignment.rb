class CohortInstructorAssignment < ApplicationRecord
  belongs_to :cohort
  belongs_to :user

  validates :user_id, uniqueness: { scope: :cohort_id }
  validate :user_is_instructor

  private

  def user_is_instructor
    errors.add(:user, "must be an instructor") unless user&.instructor?
  end
end

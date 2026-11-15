class CohortInstructorAssignment < ApplicationRecord
  belongs_to :cohort
  belongs_to :user

  validates :user_id, uniqueness: { scope: :cohort_id }
  validate :user_is_instructor

  # Staff presence streams follow cohort assignments. Reconnect the instructor
  # so their subscriptions pick up an added cohort or drop a removed one.
  after_commit :reset_instructor_cable_connections, on: %i[create destroy]

  private

  def user_is_instructor
    errors.add(:user, "must be an instructor") unless user&.instructor?
  end

  def reset_instructor_cable_connections
    instructor = User.find_by(id: user_id)
    CableConnectionReset.call(instructor) if instructor
  end
end

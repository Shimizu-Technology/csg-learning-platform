class PrivateMeetingConfig < ApplicationRecord
  belongs_to :cohort
  belongs_to :instructor, class_name: "User"
  has_many :private_meeting_slots, dependent: :restrict_with_error

  validates :cohort_id, uniqueness: true
  validates :instructor, presence: true
  validate :instructor_is_staff

  def week_for(time)
    local_date = time.in_time_zone(timezone).to_date
    number = (local_date - cohort.start_date).to_i.div(7) + 1
    return nil unless number.between?(1, weeks)
    return nil if cohort.end_date && local_date > cohort.end_date

    number
  end

  private

  def instructor_is_staff
    errors.add(:instructor, "must be an instructor or admin") if instructor && !instructor.staff?
  end
end

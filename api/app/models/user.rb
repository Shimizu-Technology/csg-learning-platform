class User < ApplicationRecord
  enum :role, { student: 0, instructor: 1, admin: 2 }

  has_many :enrollments, dependent: :destroy
  has_many :cohorts, through: :enrollments
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :graded_submissions, class_name: "Submission", foreign_key: :graded_by_id, dependent: :nullify

  validates :clerk_id, presence: true, uniqueness: true
  validates :email, presence: true, uniqueness: { case_sensitive: false }
  validates :role, presence: true

  def full_name
    [first_name, last_name].compact.join(" ").presence || email.split("@").first
  end

  def staff?
    admin? || instructor?
  end
end

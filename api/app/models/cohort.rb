class Cohort < ApplicationRecord
  enum :cohort_type, { bootcamp: 0, workshop: 1, alumni: 2, custom: 3 }
  enum :status, { upcoming: 0, active: 1, completed: 2, archived: 3 }

  belongs_to :curriculum
  has_many :enrollments, dependent: :destroy
  has_many :users, through: :enrollments

  validates :name, presence: true
  validates :start_date, presence: true
end

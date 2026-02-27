class Curriculum < ApplicationRecord
  self.table_name = "curricula"

  enum :status, { draft: 0, active: 1, archived: 2 }

  has_many :modules, class_name: "CurriculumModule", dependent: :destroy
  has_many :cohorts, dependent: :restrict_with_error

  validates :name, presence: true
end

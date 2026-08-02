class Curriculum < ApplicationRecord
  self.table_name = "curricula"

  enum :status, { draft: 0, active: 1, archived: 2 }

  has_many :modules, -> { order(:position) }, class_name: "CurriculumModule", dependent: :destroy
  has_many :cohorts, dependent: :restrict_with_error
  has_many :learning_objectives, -> { ordered }, dependent: :destroy
  has_many :rubrics, dependent: :destroy

  validates :name, presence: true
end

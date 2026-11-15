class Curriculum < ApplicationRecord
  self.table_name = "curricula"

  enum :status, { draft: 0, active: 1, archived: 2 }

  has_many :modules, -> { order(:position) }, class_name: "CurriculumModule", dependent: :destroy
  has_many :cohorts, dependent: :restrict_with_error
  has_many :learning_objectives, -> { ordered }, dependent: :destroy
  has_many :rubrics, dependent: :destroy
  has_many :curriculum_resources, dependent: :restrict_with_error

  # Lock every block in the curriculum in id order before the modules' own
  # deletes run (see Lesson's before_destroy).
  before_destroy -> { ContentBlock.lock_against_learner_writes!(ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: id }).pluck(:id)) }, prepend: true

  validates :name, presence: true
end

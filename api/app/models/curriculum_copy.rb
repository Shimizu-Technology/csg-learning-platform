# A cohort's own copy of a curriculum it used to share ("Make a copy for this
# cohort", CurriculumCopyForCohort). Records who made it, from what, and what
# moved; its content_redirects let that cohort's learners keep opening the
# shared curriculum's ids they already hold (MovedContent).
class CurriculumCopy < ApplicationRecord
  belongs_to :cohort
  belongs_to :source_curriculum, class_name: "Curriculum", optional: true
  belongs_to :copy_curriculum, class_name: "Curriculum"
  belongs_to :created_by, class_name: "User", optional: true
  has_many :content_redirects, dependent: :delete_all
end

class Submission < ApplicationRecord
  enum :grade, { A: 0, B: 1, C: 2, R: 3 }

  belongs_to :content_block
  belongs_to :user
  belongs_to :grader, class_name: "User", foreign_key: :graded_by_id, optional: true

  validates :content_block_id, presence: true
  validates :user_id, presence: true
end

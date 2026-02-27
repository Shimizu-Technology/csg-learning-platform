class ContentBlock < ApplicationRecord
  enum :block_type, { video: 0, text: 1, exercise: 2, code_challenge: 3, checkpoint: 4, recording: 5 }

  belongs_to :lesson
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy

  validates :block_type, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  default_scope { order(:position) }
end

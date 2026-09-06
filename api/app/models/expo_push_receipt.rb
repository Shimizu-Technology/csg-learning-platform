class ExpoPushReceipt < ApplicationRecord
  belongs_to :mobile_push_token

  validates :receipt_id, presence: true, uniqueness: true

  scope :due, -> { where(available_at: ..Time.current).order(:available_at, :id) }
end

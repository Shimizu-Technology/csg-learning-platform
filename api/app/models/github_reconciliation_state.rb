class GithubReconciliationState < ApplicationRecord
  STATUSES = %w[idle ok backoff failed].freeze

  belongs_to :github_repository_binding

  validates :github_repository_binding_id, uniqueness: true
  validates :activated_at, presence: true
  validates :last_status, inclusion: { in: STATUSES }
  validates :consecutive_failures, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  def claimed?(at = Time.current)
    claim_token.present? && claimed_until.present? && claimed_until > at
  end
end

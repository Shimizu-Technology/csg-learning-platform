class GithubAppInstallation < ApplicationRecord
  belongs_to :cohort
  has_many :github_repository_bindings, dependent: :destroy

  validates :app_id, :installation_id, :account_id, numericality: { only_integer: true, greater_than: 0 }
  validates :installation_id, uniqueness: { scope: :cohort_id }
  validates :account_login, :connected_at, :checked_at, presence: true
  validates :account_type, inclusion: { in: %w[User Organization] }
  validates :repository_selection, inclusion: { in: %w[all selected] }
  validates :connection_state, inclusion: { in: %w[connected failed] }

  def fail_connection!(reason)
    update!(connection_state: "failed", failure_reason: reason, checked_at: Time.current)
    github_repository_bindings.update_all(verification_state: "failed", failure_reason: reason, verified_at: nil, updated_at: Time.current)
  end
end

class WorkspaceMembership < ApplicationRecord
  enum :role, { member: 0, manager: 1 }

  belongs_to :workspace
  belongs_to :user

  validates :user_id, uniqueness: { scope: :workspace_id }
end

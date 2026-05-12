class Channel < ApplicationRecord
  enum :visibility, { cohort: 0, staff_only: 1 }
  enum :status, { active: 0, archived: 1 }

  belongs_to :cohort, optional: true
  belongs_to :workspace
  has_many :messages, dependent: :destroy
  has_many :channel_read_states, dependent: :destroy
  has_many :message_preferences, as: :target, dependent: :destroy

  before_validation :sync_workspace_links

  validates :name, presence: true, uniqueness: { scope: :workspace_id }
  validates :visibility, presence: true
  validates :status, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position, :name) }

  def self.visible_for(user)
    return none unless user
    return active if user.staff?

    workspace_ids = Workspace.visible_for(user).select(:id)
    active.where(workspace_id: workspace_ids, visibility: visibilities[:cohort])
  end

  def visible_to?(user)
    return false unless user
    return true if user.staff?
    return false if staff_only?

    workspace.visible_to?(user)
  end

  def can_post?(user)
    return false unless visible_to?(user)
    return false if archived?

    true
  end

  def recipients
    if staff_only?
      User.not_archived.where(role: [ User.roles[:instructor], User.roles[:admin] ])
    else
      workspace.recipient_users
    end
  end

  private

  def sync_workspace_links
    self[:cohort_id] ||= workspace&.cohort_id
    self.workspace ||= cohort&.workspace
  end
end

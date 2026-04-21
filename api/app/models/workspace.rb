require "securerandom"

class Workspace < ApplicationRecord
  enum :workspace_type, { cohort: 0, community: 1 }
  enum :status, { active: 0, archived: 1 }

  belongs_to :cohort, optional: true
  has_many :workspace_memberships, dependent: :destroy
  has_many :users, through: :workspace_memberships
  has_many :channels, dependent: :destroy
  has_many :direct_conversations, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true
  validates :cohort_id, uniqueness: true, allow_nil: true
  validates :workspace_type, presence: true
  validates :status, presence: true
  validate :cohort_matches_workspace_type

  scope :ordered, -> { order(:name) }

  def self.visible_for(user)
    return none unless user
    return active.includes(:cohort) if user.staff?

    enrollment_scope = where(cohort_id: user.enrollments.active.select(:cohort_id))
    membership_scope = joins(:workspace_memberships).where(workspace_memberships: { user_id: user.id })

    active.where(id: enrollment_scope.select(:id)).or(active.where(id: membership_scope.select(:id))).distinct
  end

  def visible_to?(user)
    return false unless user
    return true if user.staff?

    cohort_id.present? && user.enrollments.active.exists?(cohort_id: cohort_id) ||
      workspace_memberships.exists?(user_id: user.id)
  end

  def available_users_for(current_user)
    available_users_scope(current_user).where.not(id: current_user.id)
  end

  def recipient_users
    available_users_scope(nil)
  end

  def ensure_default_channels!
    default_name, default_description =
      if cohort?
        [ "Class Chat", "General class discussion for this cohort." ]
      else
        [ "General", "General discussion for this workspace." ]
      end

    channels.find_or_create_by!(name: default_name) do |channel|
      channel.cohort_id = cohort_id
      channel.description = default_description
      channel.visibility = :cohort
      channel.status = :active
      channel.position = 0
    end
  end

  def self.find_or_create_for_cohort!(cohort)
    cohort.workspace || create!(
      cohort: cohort,
      name: cohort.name,
      slug: "#{cohort.name.to_s.parameterize.presence || 'workspace'}-#{cohort.id}",
      workspace_type: :cohort,
      status: cohort.archived? ? :archived : :active,
      description: "Workspace for #{cohort.name}"
    ).tap(&:ensure_default_channels!)
  end

  def self.build_community_slug(name, attempt: 0)
    base = name.to_s.parameterize.presence || "workspace"
    return base if attempt.zero?

    "#{base}-#{attempt + 1}-#{SecureRandom.hex(2)}"
  end

  def listed_members
    if cohort?
      User.where(id: cohort.enrollments.active.select(:user_id)).order(:first_name, :last_name, :email)
    else
      User.where(id: workspace_memberships.select(:user_id)).order(:first_name, :last_name, :email)
    end
  end

  private

  def available_users_scope(current_user)
    scope =
      if cohort_id.present?
        student_ids = cohort.enrollments.active.select(:user_id)
        User.where(id: student_ids).or(User.where(role: [ User.roles[:instructor], User.roles[:admin] ]))
      else
        User.where(id: workspace_memberships.select(:user_id)).or(User.where(role: [ User.roles[:instructor], User.roles[:admin] ]))
      end

    scope = scope.where.not(id: current_user.id) if current_user
    scope.distinct.order(:first_name, :last_name, :email)
  end

  def cohort_matches_workspace_type
    if cohort? && cohort_id.blank?
      errors.add(:cohort, "must exist for cohort workspaces")
    elsif community? && cohort_id.present?
      errors.add(:cohort, "must be blank for community workspaces")
    end
  end
end

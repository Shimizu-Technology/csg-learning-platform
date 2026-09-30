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
    workspace_ids = Workspace.visible_for(user).select(:id)
    scope = active.where(workspace_id: workspace_ids)
    return scope if user.staff?

    visible = scope.where(visibility: visibilities[:cohort])
    visible.where(cohort_id: nil)
      .or(visible.where.not(cohort_id: Cohort.where(course_delivery: "self_paced").select(:id)))
  end

  def visible_to?(user)
    return false unless user
    return false unless workspace.visible_to?(user)
    return false if staff_only? && !user.staff?
    return false if cohort&.self_paced? && !user.staff?

    true
  end

  def can_post?(user)
    return false unless visible_to?(user)
    return false if archived?
    return false if cohort&.completed? || cohort&.archived?
    return false if cohort && user.student? && !user.enrollments.active.exists?(cohort_id: cohort.id)

    return false if cohort && user.student? && !user.enrollments.active.find_by(cohort: cohort)&.instructor_support_active?

    true
  end

  def recipients
    if staff_only?
      if cohort
        User.not_archived.where(role: User.roles[:admin])
          .or(User.not_archived.where(id: cohort.cohort_instructor_assignments.select(:user_id)))
      else
        User.not_archived.where(role: [ User.roles[:instructor], User.roles[:admin] ])
      end
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

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

  def self.self_paced_peer_space_enabled?(cohort, school: nil)
    return false unless cohort&.self_paced?

    features = FeatureSwitches.for(cohort: cohort, school: school)
    features["class_channels"] == true && features["self_paced_peer_space"] == true
  end

  def self.visible_for(user)
    return none unless user
    workspace_ids = Workspace.visible_for(user).select(:id)
    scope = active.where(workspace_id: workspace_ids)
    return scope if user.staff?

    school = FeatureSwitches.school
    cohorts = user.accessible_cohorts.to_a
    disabled_ids = cohorts.select { |cohort| !FeatureSwitches.for(cohort: cohort, school: school)["class_channels"] }.map(&:id)
    scope = scope.where(cohort_id: nil).or(scope.where.not(cohort_id: disabled_ids)) if disabled_ids.any?
    paused_cohorts = user.enrollments.with_read_access.where(status: :paused).select(:cohort_id)
    scope = scope.where(cohort_id: nil).or(scope.where.not(cohort_id: paused_cohorts))
    visible = scope.where(visibility: visibilities[:cohort])
    active_cohort_ids = user.enrollments.active.pluck(:cohort_id).to_set
    enabled_self_paced_ids = cohorts.select do |cohort|
      self_paced_peer_space_enabled?(cohort, school: school) && active_cohort_ids.include?(cohort.id)
    end.map(&:id)
    hidden_self_paced = Cohort.where(course_delivery: "self_paced")
    hidden_self_paced = hidden_self_paced.where.not(id: enabled_self_paced_ids) if enabled_self_paced_ids.any?
    visible.where(cohort_id: nil)
      .or(visible.where.not(cohort_id: hidden_self_paced.select(:id)))
  end

  def visible_to?(user)
    return false unless user
    return false unless workspace.visible_to?(user)
    return false if !user.staff? && cohort && !FeatureSwitches.for(cohort: cohort)["class_channels"]
    return false if workspace.paused_for?(user)
    return false if staff_only? && !user.staff?
    if cohort&.self_paced? && !user.staff?
      return false unless self.class.self_paced_peer_space_enabled?(cohort)
      return false unless user.enrollments.active.exists?(cohort_id: cohort.id)
    end

    true
  end

  # Learners can post while their enrollment and support window are active.
  # For self-paced peer-space channels, support starts on first course open and
  # ends at support_expires_at; once support expires, the channel stays readable
  # until access_expires_at while posting stops cleanly.
  def can_post?(user, visible: nil, enrollment: :unloaded)
    return false unless visible.nil? ? visible_to?(user) : visible
    return false if archived?
    return false if cohort&.completed? || cohort&.archived?
    return true unless cohort && user.student?

    active_enrollment = enrollment == :unloaded ? user.enrollments.active.find_by(cohort_id: cohort.id) : enrollment
    return false unless active_enrollment

    active_enrollment.instructor_support_active?
  end

  def post_disabled_reason(user, visible: nil, enrollment: :unloaded)
    return nil if can_post?(user, visible: visible, enrollment: enrollment)
    return "This conversation is archived." if archived?
    return "This course has ended. Past messages remain readable." if cohort&.completed? || cohort&.archived?

    if cohort && user&.student?
      active_enrollment = enrollment == :unloaded ? user.enrollments.active.find_by(cohort_id: cohort.id) : enrollment
      return "Posting is unavailable for your enrollment." unless active_enrollment

      if cohort.self_paced? && active_enrollment.support_expires_at.nil?
        return "Open Today or a lesson to start your course support period before posting."
      end

      return "Your support period has ended. Past messages remain readable." unless active_enrollment.instructor_support_active?
    end

    "You cannot post in this conversation."
  end

  def recipients
    if staff_only?
      if cohort
        User.not_archived.where(role: User.roles[:admin])
          .or(User.not_archived.where(id: cohort.cohort_instructor_assignments.select(:user_id)))
      else
        workspace.recipient_users.where(role: [ User.roles[:instructor], User.roles[:admin] ])
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

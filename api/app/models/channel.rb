class Channel < ApplicationRecord
  enum :visibility, { cohort: 0, staff_only: 1 }
  enum :status, { active: 0, archived: 1 }

  belongs_to :cohort
  has_many :messages, dependent: :destroy
  has_many :channel_read_states, dependent: :destroy

  validates :name, presence: true, uniqueness: { scope: :cohort_id }
  validates :visibility, presence: true
  validates :status, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position, :name) }

  def self.visible_for(user)
    return none unless user
    return active if user.staff?

    cohort_ids = user.enrollments.active.select(:cohort_id)
    active.cohort.where(cohort_id: cohort_ids)
  end

  def visible_to?(user)
    return false unless user
    return true if user.staff?
    return false if staff_only?

    user.enrollments.active.exists?(cohort_id: cohort_id)
  end

  def can_post?(user)
    return false unless visible_to?(user)
    return false if archived?

    true
  end

  def recipients
    if staff_only?
      User.where(role: [ User.roles[:instructor], User.roles[:admin] ])
    else
      User.where(id: cohort.enrollments.active.select(:user_id)).or(
        User.where(role: [ User.roles[:instructor], User.roles[:admin] ])
      ).distinct
    end
  end
end

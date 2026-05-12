class Announcement < ApplicationRecord
  enum :audience, { cohort: 0, global: 1, staff: 2 }
  enum :status, { draft: 0, published: 1, archived: 2 }

  belongs_to :cohort, optional: true
  belongs_to :author, class_name: "User"
  has_many :notifications, as: :notifiable, dependent: :destroy

  validates :title, presence: true
  validates :body, presence: true
  validates :audience, presence: true
  validates :status, presence: true
  validates :cohort, presence: true, if: :cohort?
  validate :cohort_only_for_cohort_audience

  before_validation :set_published_at, if: :published?

  scope :visible_now, -> { published.where("published_at IS NULL OR published_at <= ?", Time.current) }
  scope :ordered, -> { order(pinned: :desc, published_at: :desc, created_at: :desc) }

  def self.visible_for(user)
    return none unless user
    return visible_for_staff(user) if user.staff?

    cohort_ids = user.enrollments.active.select(:cohort_id)
    visible_now.where(audience: :global).or(
      visible_now.where(audience: :cohort, cohort_id: cohort_ids)
    )
  end

  def self.visible_for_staff(_user)
    visible_now.where(audience: audiences.values)
  end

  def recipients
    case audience
    when "cohort"
      return User.none unless cohort

      User.not_archived.where(id: cohort.enrollments.active.select(:user_id))
    when "staff"
      User.not_archived.where(role: [ User.roles[:instructor], User.roles[:admin] ])
    else
      active_student_ids = Enrollment.active.select(:user_id)
      User.not_archived.where(id: active_student_ids).or(User.not_archived.where(role: [ User.roles[:instructor], User.roles[:admin] ])).distinct
    end
  end

  private

  def set_published_at
    self.published_at ||= Time.current
  end

  def cohort_only_for_cohort_audience
    return if cohort? || cohort_id.blank?

    errors.add(:cohort, "can only be set for cohort announcements")
  end
end

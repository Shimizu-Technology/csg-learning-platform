class Announcement < ApplicationRecord
  enum :audience, { cohort: 0, global: 1, staff: 2 }
  enum :status, { draft: 0, published: 1, archived: 2 }

  belongs_to :cohort, optional: true
  belongs_to :author, class_name: "User"
  # The last person to change a posted update's title or body (U-3.6). Only
  # the latest edit is kept, as for messages.
  belongs_to :edited_by, class_name: "User", optional: true
  has_many :notifications, as: :notifiable, dependent: :destroy

  normalizes :body, with: ->(body) { MarkdownText.normalize(body) }

  validates :title, presence: true
  # A draft can be saved before its text is written; posting needs the text.
  validates :body, presence: true, unless: :draft?
  validates :audience, presence: true
  validates :status, presence: true
  validates :cohort, presence: true, if: :cohort?
  validate :cohort_only_for_cohort_audience
  validate :audience_fixed_once_posted, on: :update
  validate :posted_updates_stay_posted, on: :update

  before_validation :set_published_at, if: :published?
  before_validation { self.body = "" if body.nil? }

  scope :visible_now, -> { published.where("published_at IS NULL OR published_at <= ?", Time.current) }
  scope :ordered, -> { order(pinned: :desc, published_at: :desc, created_at: :desc) }
  # Drafts belong to their author until they are posted; admins see every
  # draft. Nobody else, staff included, sees one in a list, detail or search.
  scope :drafts_visible_to, ->(user) { user&.admin? ? all : where.not(status: :draft).or(where(author_id: user&.id)) }

  AUDIENCE_LOCKED_MESSAGE = "can't change after an update is posted. Post a new update to reach a different group".freeze

  def self.visible_for(user)
    return none unless user
    return visible_for_staff(user) if user.staff?

    cohort_ids = user.enrollments.with_read_access.select(:cohort_id)
    visible_now.where(audience: :global).or(
      visible_now.where(audience: :cohort, cohort_id: cohort_ids)
    )
  end

  def self.visible_for_staff(user)
    return visible_now.where(audience: audiences.values) if user.admin?

    visible_now.where(audience: [ :global, :staff ]).or(
      visible_now.where(audience: :cohort, cohort_id: user.cohort_instructor_assignments.select(:cohort_id))
    )
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

  # The author, or an admin, may change a draft or a posted update. Callers
  # also check that the person can still post to its audience.
  def editable_by?(user)
    return false unless user&.staff?

    user.admin? || author_id == user.id
  end

  # Readers see "Edited" when a posted update's words change. Draft edits
  # and pin or archive changes are not edits.
  def record_edit(editor)
    return if status_in_database == "draft"
    return unless will_save_change_to_title? || will_save_change_to_body?

    self.edited_at = Time.current
    self.edited_by = editor
  end

  private

  # Posting a draft stamps the time it was posted, not when it was drafted.
  def set_published_at
    posting_draft = persisted? && will_save_change_to_status? && status_in_database == "draft"
    self.published_at = Time.current if published_at.nil? || posting_draft
  end

  def cohort_only_for_cohort_audience
    return if cohort? || cohort_id.blank?

    errors.add(:cohort, "can only be set for cohort announcements")
  end

  # Everyone who was told about the update keeps it; reaching another group
  # is a new update (U-3.6).
  def audience_fixed_once_posted
    return if status_in_database == "draft"
    return unless will_save_change_to_audience? || will_save_change_to_cohort_id?

    errors.add(:audience, AUDIENCE_LOCKED_MESSAGE)
  end

  def posted_updates_stay_posted
    return if status_in_database == "draft" || !draft?

    errors.add(:status, "can't go back to draft after the update is posted")
  end
end

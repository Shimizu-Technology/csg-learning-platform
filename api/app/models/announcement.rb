class Announcement < ApplicationRecord
  enum :audience, { cohort: 0, global: 1, staff: 2 }
  enum :status, { draft: 0, published: 1, archived: 2 }

  belongs_to :cohort, optional: true
  belongs_to :author, class_name: "User"
  # The last person to change a posted update's title or body (U-3.6). Only
  # the latest edit is kept, as for messages.
  belongs_to :edited_by, class_name: "User", optional: true
  # Who scheduled a draft to post itself (U-3.6). The hourly tick checks, as
  # it posts, that they can still post to the update's audience.
  belongs_to :scheduled_by, class_name: "User", optional: true
  has_many :notifications, as: :notifiable, dependent: :destroy
  # Cohort deletion also destroys announcements. Lock before dependent cleanup
  # can read notifications, or a concurrent batch could commit after that read
  # and leave orphan rows behind when the parent DELETE finally gets its lock.
  before_destroy :lock_before_notification_cleanup, prepend: true

  normalizes :body, with: ->(body) { MarkdownText.normalize(body) }

  validates :title, presence: true
  # A draft can be saved before its text is written; posting, or scheduling
  # it to post, needs the text.
  validates :body, presence: true, unless: -> { draft? && scheduled_for.nil? }
  validates :audience, presence: true
  validates :status, presence: true
  validates :cohort, presence: true, if: :cohort?
  validate :cohort_only_for_cohort_audience
  validate :audience_fixed_once_posted, on: :update
  validate :posted_updates_stay_posted, on: :update
  validate :schedule_only_while_draft
  validate :schedule_ahead, if: -> { scheduled_for.present? && will_save_change_to_scheduled_for? }

  before_save :clear_schedule_failure

  def clear_schedule_failure
    return unless schedule_failure.present? && (published? || (scheduled_for.present? && will_save_change_to_scheduled_for?))

    # The unique source key must not swallow a later publication alert.
    notifications.where(notification_type: :system).delete_all if persisted?
    self.schedule_failure = nil
  end

  before_validation :set_published_at, if: :published?
  before_validation { self.body = "" if body.nil? }

  scope :visible_now, -> { published.where("published_at IS NULL OR published_at <= ?", Time.current) }
  scope :ordered, -> { order(pinned: :desc, published_at: :desc, created_at: :desc) }
  # A scheduled update is a draft with a send time (U-3.6): until the tick
  # posts it, it is hidden wherever drafts are (`visible_now` is published
  # only, and `drafts_visible_to` limits it to its author and admins).
  scope :scheduled, -> { draft.where.not(scheduled_for: nil) }
  scope :unscheduled_drafts, -> { draft.where(scheduled_for: nil) }
  # Posted with push, and not every recipient has been claimed by both push
  # providers yet (the push outbox; see PushNotificationJob).
  scope :fanout_pending, -> { where.not(fanout_requested_at: nil).where(fanout_settled_at: nil) }
  scope :push_pending, -> { where.not(push_requested_at: nil).where(push_settled_at: nil) }
  # Drafts belong to their author until they are posted; admins see every
  # draft. Nobody else, staff included, sees one in a list, detail or search.
  scope :drafts_visible_to, ->(user) { user&.admin? ? all : where.not(status: :draft).or(where(author_id: user&.id)) }

  AUDIENCE_LOCKED_MESSAGE = "can't change after an update is posted. Post a new update to reach a different group".freeze
  # How far ahead an update can be scheduled.
  SCHEDULE_HORIZON = 1.year

  # Scheduled times are chosen and shown in the school's time zone. Cohorts
  # have no zone of their own, so every audience uses the school's.
  def self.schedule_time_zone = Rails.application.config.x.school.time_zone

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

  def scheduled?
    draft? && scheduled_for.present?
  end

  # Whether `user` may post to this update's audience right now: admins
  # anywhere, instructors in a cohort they teach. The tick asks this of
  # whoever scheduled the update before it posts it.
  def postable_by?(user)
    return false unless user&.staff? && !user.archived?
    return true if user.admin?

    cohort? && cohort_id.present? && user.cohort_instructor_assignments.exists?(cohort_id: cohort_id)
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

  def lock_before_notification_cleanup
    self.class.where(id: id).lock.pick(:id)
  end

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

  # Only a draft waits for a send time; once posted, the time it was
  # scheduled for is history and can't be changed.
  def schedule_only_while_draft
    return unless will_save_change_to_scheduled_for? && scheduled_for.present?
    return if draft?

    errors.add(:base, "An update that has been posted can't be scheduled")
  end

  def schedule_ahead
    if scheduled_for <= Time.current
      errors.add(:base, "Choose a send time in the future")
    elsif scheduled_for > SCHEDULE_HORIZON.from_now
      errors.add(:base, "Choose a send time within a year")
    end
  end

  def posted_updates_stay_posted
    return if status_in_database == "draft" || !draft?

    errors.add(:status, "can't go back to draft after the update is posted")
  end
end

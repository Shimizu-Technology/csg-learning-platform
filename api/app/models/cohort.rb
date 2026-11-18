class Cohort < ApplicationRecord
  has_many :github_app_installations, dependent: :destroy
  before_update :preserve_missing_paused_libraries

  def preserve_missing_paused_libraries
    return unless will_save_change_to_start_date? || will_save_change_to_learner_pace_weeks?

    Enrollment.capture_missing_paused_libraries!(enrollments)
  end

  has_many :feature_switch_changes, dependent: :nullify
  ALUMNI_GITHUB_ORGANIZATION = "Code-School-of-Guam-Alumni".freeze
  # A staff save that named one of this cohort's modules (or lessons) refused
  # because "Make a copy for this cohort" moved the cohort to its own copy
  # while the save waited (ApplicationController#lock_cohort_for_module_write!).
  CONTENT_MOVED_MESSAGE = "This cohort moved to its own copy of the curriculum while this was saving. Reload, then save again.".freeze

  enum :cohort_type, { bootcamp: 0, workshop: 1, alumni: 2, custom: 3 }
  enum :status, { upcoming: 0, active: 1, completed: 2, archived: 3 }

  # Stored upcoming cohorts become active by the school calendar, without writes.
  scope :active, ->(on: LearningCalendar.today) { where(status: :active).or(where(status: :upcoming).where("start_date <= ?", on)) }

  def active?
    super || (upcoming? && start_date.present? && start_date <= LearningCalendar.today)
  end

  def effective_status
    active? ? "active" : status
  end

  def status=(value)
    @explicit_status = true
    super
  end

  belongs_to :curriculum
  belongs_to :support_instructor, class_name: "User", optional: true
  has_many :enrollments, dependent: :destroy
  has_many :users, through: :enrollments
  has_many :cohort_instructor_assignments, dependent: :destroy
  has_many :instructors, through: :cohort_instructor_assignments, source: :user
  has_many :recordings, dependent: :destroy
  has_many :announcements, dependent: :destroy
  has_one :workspace, dependent: :destroy
  has_many :channels, dependent: :destroy
  has_many :direct_conversations, dependent: :destroy
  has_many :cohort_module_schedules, dependent: :destroy
  has_many :cohort_module_submission_windows, dependent: :destroy
  has_many :office_hours, dependent: :destroy
  has_one :private_meeting_config, dependent: :restrict_with_error
  has_many :private_meeting_bookings, dependent: :restrict_with_error
  has_many :help_requests, dependent: :destroy
  # Bookkeeping for "Make a copy for this cohort"; the database cascades both.
  has_many :curriculum_copies, dependent: :delete_all
  has_many :content_redirects, dependent: :delete_all
  has_many :course_purchases, dependent: :restrict_with_error

  around_save :lock_curriculum_for_availability
  # Lesson-editing grant and revoke records (ActivityEvent::CONTENT_TYPES) are
  # staff audit rows, kept after the cohort goes: the delete detaches them
  # instead of being blocked by their cohort reference.
  before_destroy :detach_content_audit_events

  validates :name, presence: true
  validates :start_date, presence: true
  validates :self_paced_access_months, :self_paced_support_weeks, numericality: { only_integer: true, greater_than: 0 }
  validates :course_delivery, inclusion: { in: %w[program guided self_paced] }
  before_validation :normalize_learner_pace_weeks
  validate :learner_pace_weeks_are_valid
  after_create { @explicit_status = false }
  after_save { @explicit_status = false }
  validate :upcoming_requires_future_start, on: :update

  def upcoming_requires_future_start
    if @explicit_status && upcoming? && start_date && start_date <= LearningCalendar.today
      errors.add(:status, "Move the start date to hold this cohort. To take it off sale, turn off checkout.")
    end
  end

  # Set only by CurriculumCopyForCohort#move_cohort!, to the curriculum the
  # cohort is leaving: "Make a copy for this cohort" is the one sanctioned way
  # to change an enrolled cohort's curriculum (its learner data moves with
  # it), and the copy remaps content_defaults itself. Not a permitted param.
  attr_accessor :moving_to_copy_of

  validate :curriculum_change_allowed
  before_save :reset_content_defaults_for_curriculum
  validate :guided_access_dates_are_valid
  validate :checkout_is_self_paced
  validate :support_instructor_is_staff
  validates :public_price_cents, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :stripe_price_id, format: { with: /\Aprice_[a-zA-Z0-9_]+\z/ }, allow_blank: true
  validates :github_organization_name, format: { with: /\A[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\z/i }, allow_blank: true

  before_save :record_class_resource_availability, if: :will_save_change_to_settings?

  before_validation :default_status_by_start_date, on: :create
  validates :public_image_url, format: { with: /\Ahttps:\/\/[^\s]+\z/ }, allow_blank: true

  before_save :assign_public_slug
  validates :public_slug, uniqueness: true, format: { with: /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/ }, allow_nil: true
  validate :public_slug_is_stable
  validates :public_duration, :review_response_time, length: { maximum: 200 }

  def effective_review_response_time
    review_response_time.presence || SchoolSetting.current.review_response_time
  end

  # These names remain available for course collection/actions as routes grow.
  RESERVED_PUBLIC_SLUGS = %w[new edit checkout return canceled success status].freeze
  validates :public_slug, exclusion: { in: RESERVED_PUBLIC_SLUGS }, allow_nil: true

  # parameterize keeps underscores, which the slug format rejects.
  def self.public_slug_base(title)
    title.to_s.parameterize.tr("_", "-").squeeze("-").delete_prefix("-").delete_suffix("-")
  end

  def assign_public_slug
    return unless public_slug.nil? && public_title.present?

    # One allocation lock also covers a title that equals another title's suffix.
    self.class.connection.execute("SELECT pg_advisory_xact_lock(hashtext('public-course-slug'))")
    stored_slug = self.class.uncached { self.class.where(id: id).pick(:public_slug) } if persisted?
    if stored_slug.present?
      self.public_slug = stored_slug
      return
    end

    base = self.class.public_slug_base(public_title)
    if base.blank? || RESERVED_PUBLIC_SLUGS.include?(base)
      self.id ||= self.class.connection.select_value("SELECT nextval(#{self.class.connection.quote(self.class.sequence_name)})")
      base = "course-#{id}"
    end
    candidate = base
    suffix = 1
    while self.class.exists?(public_slug: candidate)
      suffix += 1
      candidate = "#{base}-#{suffix}"
    end
    self.public_slug = candidate
  end

  def public_slug_is_stable
    errors.add(:public_slug, "cannot change") if persisted? && public_slug_in_database.present? && will_save_change_to_public_slug?
  end

  def setup_readiness
    offering_readiness.merge(
      catalog_copy: public_title.present? && public_description.present? && public_image_url.present?,
      school_checkout_enabled: CourseCheckout.enabled?
    )
  end

  def default_status_by_start_date
    self.status = start_date && start_date > LearningCalendar.today ? :upcoming : :active unless @explicit_status
  end

  before_validation :normalize_github_organization_name
  before_validation :default_alumni_github_organization, on: :create
  after_create :initialize_content_defaults!
  after_create :provision_workspace
  after_update :complete_alumni_enrollments, if: :became_alumni?
  after_update :realign_personal_pace_plans, if: -> { saved_change_to_start_date? && personal_pace? }
  # Who saved this cohort, for revisions written by its callbacks (set by the controller).
  attr_accessor :edited_by

  def class_resources_for_read(enrollment = nil)
    Array((settings || {})["class_resources"]).select { |resource| content_link_available_for_read?(resource, enrollment) }
  end

  def content_link_available_for_read?(resource, enrollment, date_key: nil)
    return true unless enrollment&.paused?

    available_at = Time.iso8601(resource["available_at"]) if resource["available_at"].present?
    recorded_on = Date.iso8601(resource[date_key]) if date_key && resource[date_key].present?
    enrollment.content_available_for_read?(available_at || updated_at, recorded_on)
  rescue ArgumentError
    false
  end

  def record_class_resource_availability
    %w[class_resources recordings].each do |key|
      next unless settings&.key?(key)

      previous = Array((settings_in_database || {})[key]).index_by { |resource| resource["url"] }
      self.settings = settings.merge(key => Array(settings[key]).map do |resource|
        resource = resource.stringify_keys
        old = previous[resource["url"]]
        available_at = old ? old["available_at"].presence || updated_at&.iso8601 : Time.current.iso8601
        resource.merge("available_at" => available_at || Time.current.iso8601)
      end)
    end
  end

  # A complete snapshot makes an empty selection durable, including when no
  # learners are enrolled. New library modules are opt-in for existing cohorts.
  def initialize_content_defaults!
    return if content_defaults.present? || content_defaults == {}

    update!(content_defaults: curriculum.modules.to_h { |mod| [ mod.id.to_s, { assigned: true, unlocked: false, unlock_date_override: nil } ] })
  end

  def module_schedule_for(curriculum_module)
    if cohort_module_schedules.loaded?
      cohort_module_schedules.find { |schedule| schedule.module_id == curriculum_module.id }
    else
      cohort_module_schedules.find_by(module_id: curriculum_module.id)
    end
  end

  def self_paced?
    course_delivery == "self_paced"
  end

  def guided?
    course_delivery == "guided"
  end

  # W9.1 personal pace (AS-1, AS-2). A guided or self-paced cohort can offer
  # learners a choice of pace (`learner_pace_weeks`, for example [3, 4, 6]).
  # NULL is off, and every cohort starts off, so program cohorts, the alumni
  # library and any cohort that doesn't opt in compute exactly as before.
  # With it on, each enrollment has its own start (Enrollment#personal_start_on),
  # milestones come from the chosen pace (LearnerPace), and "behind" is measured
  # against them (LearnerProgress#pace).
  PACE_WEEK_RANGE = (1..26)
  MAX_PACE_OPTIONS = 4

  def personal_pace?
    learner_pace_weeks.present? && (guided? || self_paced?) && !alumni?
  end

  # A guided cohort with personal pace opens every assigned lesson on each
  # learner's own start date instead of the cohort calendar. Self-paced
  # courses already open everything, so their release rule is unchanged.
  # Checks the values as sent, on every assignment, before the integer column
  # casts them: Rails reads 3.5 or "3weeks" as 3, so [3.5, 4, 6] over a stored
  # [3, 4, 6] wouldn't even look like a change. Whole numbers only, as integers
  # or digit strings (form params); nil turns pace off.
  def learner_pace_weeks=(value)
    @raw_pace_choices_invalid = !value.nil? &&
      !(value.is_a?(Array) && value.all? { |item| item.is_a?(Integer) || (item.is_a?(String) && item.strip.match?(/\A\d+\z/)) })
    self[:learner_pace_weeks] = value
  end

  def personal_release?
    personal_pace? && guided?
  end

  def purchase_ready?
    self_paced? && public_checkout_enabled? && offering_readiness.values.all?
  end

  def offering_readiness
    {
      curriculum_assigned: curriculum.present? && curriculum.active?,
      price_set: stripe_price_id.present? && public_price_cents.to_i.positive?,
      support_instructor_set: valid_support_instructor?,
      published_content: published_selected_content?,
      cohort_active: active?
    }
  end

  def published_selected_content?
    return false unless curriculum

    selected_ids = if content_defaults.nil?
      curriculum.modules.ids # Same legacy fallback as enrollment assignment.
    else
      content_defaults.filter_map { |id, defaults| id if defaults["assigned"] }
    end
    curriculum.modules.where(id: selected_ids).joins(lessons: :content_blocks).merge(Lesson.active).exists?
  end

  def valid_support_instructor?
    support_instructor.present? && support_instructor.instructor? && !support_instructor.archived? && instructors.exists?(id: support_instructor_id)
  end

  def lock_curriculum_for_availability
    return yield unless new_record? || will_save_change_to_curriculum_id? || will_save_change_to_public_checkout_enabled? || will_save_change_to_status?

    # Both the curriculum the cohort leaves and the one it joins, ascending,
    # FOR UPDATE: lesson authors hold FOR SHARE on a curriculum while their
    # access (which depends on every cohort using it) is checked and saved.
    # See Curriculum.lock_for_content! for the lock order.
    transaction do
      ids = [ curriculum_id_in_database, curriculum_id ].compact.uniq.sort
      locked = Curriculum.where(id: ids).order(:id).lock.index_by(&:id)
      locked_curriculum = locked[curriculum_id] || raise(ActiveRecord::RecordNotFound.new("Couldn't find Curriculum with 'id'=#{curriculum_id}", "Curriculum", "id", curriculum_id))
      if locked_curriculum.archived? && (new_record? || will_save_change_to_curriculum_id? || public_checkout_enabled? || upcoming? || active?)
        errors.add(:curriculum, "is archived and unavailable for new cohorts or checkout")
        return false
      end
      yield
    end
  end

  def checkout_is_self_paced
    errors.add(:public_checkout_enabled, "requires a self-paced course") if public_checkout_enabled? && !self_paced?
  end

  def support_instructor_is_staff
    return unless support_instructor_id && (new_record? || will_save_change_to_support_instructor_id? || will_save_change_to_public_checkout_enabled?)

    errors.add(:support_instructor, "must be an active instructor assigned to this cohort") unless valid_support_instructor?
  end

  def submission_window_for(module_id:, week_number:)
    if cohort_module_submission_windows.loaded?
      cohort_module_submission_windows.find { |window| window.module_id == module_id && window.week_number == week_number }
    else
      cohort_module_submission_windows.find_by(module_id: module_id, week_number: week_number)
    end
  end

  private

  def curriculum_change_allowed
    return if moving_to_own_copy?

    errors.add(:curriculum, "cannot change while students are enrolled") if persisted? && will_save_change_to_curriculum_id? && enrollments.exists?
  end

  def reset_content_defaults_for_curriculum
    return unless persisted? && will_save_change_to_curriculum_id?
    return if moving_to_own_copy?

    self.content_defaults = curriculum.modules.to_h { |mod| [ mod.id.to_s, { assigned: true, unlocked: false, unlock_date_override: nil } ] }
  end

  def moving_to_own_copy?
    persisted? && will_save_change_to_curriculum_id? && !moving_to_copy_of.nil? && moving_to_copy_of == curriculum_id_in_database
  end

  def normalize_learner_pace_weeks
    return if learner_pace_weeks.nil? || @raw_pace_choices_invalid

    values = learner_pace_weeks.compact
    self.learner_pace_weeks = values.empty? ? nil : values.uniq.sort
  end

  def learner_pace_weeks_are_valid
    return if learner_pace_weeks.nil? && !@raw_pace_choices_invalid

    if @raw_pace_choices_invalid || !(learner_pace_weeks.all? { |value| value.is_a?(Integer) && PACE_WEEK_RANGE.cover?(value) } && learner_pace_weeks.size <= MAX_PACE_OPTIONS)
      errors.add(:learner_pace_weeks, "must be up to #{MAX_PACE_OPTIONS} choices of #{PACE_WEEK_RANGE.min} to #{PACE_WEEK_RANGE.max} weeks, as whole numbers")
    end
    errors.add(:learner_pace_weeks, "are only for guided or self-paced courses") unless (guided? || self_paced?) && !alumni?
  end

  # A new cohort start moves the start of every learner who has no start of
  # their own (Enrollment#personal_start_on), so their chosen pace is
  # re-planned from it in the same transaction as the cohort save. Learners
  # with a staff-set start keep their dates. Credited to the staff member who
  # edited the cohort (`edited_by`) or, failing that, the plan's last author.
  def realign_personal_pace_plans
    enrollments.active.where(starts_on: nil)
      .where(id: LearningPlan.where(active: true, source: "learner_pace").select(:enrollment_id))
      .order(:id).each do |enrollment|
      enrollment.with_lock do
        actor = edited_by || enrollment.learning_plan&.revisions&.order(:id)&.last&.author || enrollment.user
        LearnerPace.new(enrollment).regenerate!(actor: actor)
      end
    end
  end

  def guided_access_dates_are_valid
    invalid_date = false
    %w[guided_access_ends_on guided_support_ends_on].each do |attribute|
      next if public_send("#{attribute}_before_type_cast").blank?
      next if self[attribute].is_a?(Date)

      errors.add(attribute, "is invalid")
      invalid_date = true
    end
    if !invalid_date && guided_access_ends_on && guided_support_ends_on && guided_support_ends_on > guided_access_ends_on
      errors.add(:guided_support_ends_on, "must be on or before lesson access ends")
    end
    if !guided? && (guided_access_ends_on || guided_support_ends_on)
      errors.add(:course_delivery, "must be guided to set guided access dates")
    end
  end

  def normalize_github_organization_name
    self.github_organization_name = github_organization_name.to_s.strip.presence
  end

  def default_alumni_github_organization
    self.github_organization_name = ALUMNI_GITHUB_ORGANIZATION if alumni? && github_organization_name.blank?
  end

  def provision_workspace
    Workspace.find_or_create_for_cohort!(self)
  end

  def became_alumni?
    saved_change_to_cohort_type? && alumni?
  end

  def complete_alumni_enrollments
    enrollments.active.find_each(&:ensure_alumni_curriculum_modules!)
  end

  def detach_content_audit_events
    ActivityEvent.where(cohort_id: id, event_type: ActivityEvent::CONTENT_TYPES).update_all(cohort_id: nil)
  end
end

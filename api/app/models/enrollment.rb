class Enrollment < ApplicationRecord
  has_many :learner_extensions, dependent: :destroy
  has_many :learner_nudges, dependent: :destroy
  has_many :github_repository_bindings, dependent: :destroy
  class StaleLearningWrite < StandardError
    attr_reader :code

    def initialize(message = nil, code: "learning_state_reset")
      super(message)
      @code = code
    end
  end

  CONTENT_MOVED_MESSAGE = "Your course moved to its own copy while this was saving. Reload, then save again.".freeze

  enum :status, { active: 0, paused: 1, dropped: 2, completed: 3 }
  scope :unexpired, ->(at: Time.current) { where("enrollments.access_expires_at IS NULL OR enrollments.access_expires_at > ?", at) }
  scope :active, ->(at: Time.current) { where(status: statuses.fetch("active")).unexpired(at: at) }
  # Completed program enrollments retain read-only history, within any agreed deadline.
  scope :with_read_access, -> { where(status: %i[active paused completed]).unexpired }

  belongs_to :user
  belongs_to :cohort
  has_many :module_assignments, dependent: :destroy
  has_many :lesson_assignments, dependent: :destroy
  has_many :interventions, dependent: :destroy
  has_many :recovery_plans, dependent: :destroy
  has_one :learning_plan, dependent: :destroy

  # Coarse assignment reachability only; each lesson still passes the frozen
  # library/cutoff check. Writes continue to require active access separately.
  def module_reachable_for_read?(assignment, on: LearningCalendar.today)
    paused? ? assignment.present? : assignment&.accessible?(cohort, on: on)
  end

  def self.capture_missing_paused_libraries!(scope = all)
    # Older data migrations may edit calendars before the additive columns exist.
    return unless column_names.include?("paused_lesson_ids")

    scope.where(status: :paused, paused_lesson_ids: nil).find_each(&:ensure_paused_library!)
  end

  # Rows paused by an older API during rollout are captured on their first
  # read, or before a schedule edit. No timestamps or release dates are moved.
  def ensure_paused_library!
    return true unless paused? && paused_lesson_ids.nil?
    return true if @capturing_paused_library

    current = self.class.find(id)
    current.with_lock do
      if current.paused? && current.paused_lesson_ids.nil?
        current.association(:cohort).reset
        current.snapshot_paused_lessons
        current.update_columns(paused_lesson_ids: current.paused_lesson_ids, paused_library_cutoff_at: current.paused_library_cutoff_at)
      end
    end
    self.paused_lesson_ids = current.paused_lesson_ids
    self.paused_library_cutoff_at = current.paused_library_cutoff_at
    current.paused? && (current.access_expires_at.nil? || current.access_expires_at > Time.current)
  end

  def lesson_available_for_read?(lesson, assignment, lesson_assignment, on: LearningCalendar.today)
    return false unless ensure_paused_library!

    # A paused library is the set readable at pause, independent of later
    # cohort/module/lesson date edits. Authorization and assignment containment
    # remain the caller's responsibility; archived lessons stay hidden.
    if paused? && paused_lesson_ids && paused_library_cutoff_at == (paused_at || read_cutoff_at)
      governing_assignment = assignment && (cohort.self_paced? || lesson_assignment.nil?) ? assignment : lesson_assignment
      return false if governing_assignment && !content_available_for_read?(governing_assignment.created_at)

      return !lesson.archived? && paused_lesson_ids.include?(lesson.id)
    end
    return false unless lesson.available?(cohort, assignment, lesson_assignment, on: on)
    return true unless paused?

    module_governs = assignment && (cohort.self_paced? || lesson_assignment.nil?)
    unlock_date = lesson.assigned_unlock_date(cohort, assignment, module_governs ? nil : lesson_assignment)
    module_created_at = assignment.created_at if module_governs
    module_changed_at = (assignment.availability_changed_at || assignment.updated_at) if module_governs
    assignment_changed_at = if lesson_assignment && (!cohort.self_paced? || assignment.nil?)
      lesson_assignment.availability_changed_at || lesson_assignment.updated_at
    end
    content_available_for_read?(lesson.created_at, unlock_date, module_created_at, module_changed_at, assignment_changed_at)
  end

  def pause_date
    paused_at&.in_time_zone(LearningCalendar::TIMEZONE)&.to_date if paused?
  end

  def read_cutoff_date
    (paused_at || read_cutoff_at)&.in_time_zone(LearningCalendar::TIMEZONE)&.to_date if paused?
  end

  def content_available_for_read?(*availability_dates)
    return true unless paused?

    cutoff_date = read_cutoff_date
    return false unless cutoff_date

    availability_dates.compact.all? { |date| date.in_time_zone(LearningCalendar::TIMEZONE).to_date <= cutoff_date }
  end

  def recording_available_for_read?(recording)
    recording.published? && content_available_for_read?(recording.created_at, recording.published_at || recording.updated_at, recording.recorded_date)
  end

  def resource_available_for_read?(resource)
    resource.ready? && content_available_for_read?(resource.created_at, resource.ready_at || resource.updated_at)
  end

  def record_pause_date
    self.paused_at = paused? ? Time.current : nil if will_save_change_to_status?
  end

  # Also used once by the additive migration for existing paused enrollments.
  # Read-side projections use the stored array and add no per-lesson queries.
  def snapshot_paused_lessons
    previous_capture = @capturing_paused_library
    @capturing_paused_library = true
    self.paused_lesson_ids = nil
    cohort.cohort_module_schedules.load
    modules = cohort.curriculum.modules.includes(lessons: :curriculum_module)
    assigned_modules = module_assignments.includes(:curriculum_module).index_by(&:module_id)
    assigned_lessons = lesson_assignments.index_by(&:lesson_id)
    self.paused_library_cutoff_at = paused_at || read_cutoff_at
    self.paused_lesson_ids = modules.flat_map(&:lessons).select do |lesson|
      LessonReadAccess.readable?(self, lesson, assigned_modules[lesson.module_id], assigned_lessons[lesson.id])
    end.map(&:id).uniq
  ensure
    @capturing_paused_library = previous_capture
  end

  def record_paused_library
    return unless will_save_change_to_status?

    if paused?
      snapshot_paused_lessons
    else
      self.paused_lesson_ids = nil
      self.paused_library_cutoff_at = nil
    end
  end

  def learning_plan_enabled?
    learning_plan&.active? && FeatureSwitches.for(cohort: cohort)["learning_plans"]
  end

  def lesson_required?(lesson)
    learning_plan_enabled? ? learning_plan.required?(lesson) : lesson.required?
  end
  has_many :private_meeting_bookings, dependent: :restrict_with_error
  has_many :progresses, dependent: :nullify
  has_many :submissions, dependent: :nullify
  has_many :certificates
  has_one :active_certificate, -> { active }, class_name: "Certificate"
  has_many :knowledge_check_attempts, dependent: :nullify

  validates :user_id, uniqueness: { scope: :cohort_id }
  validate :starts_on_needs_personal_pace

  before_save :record_paused_library
  before_validation :record_pause_date
  before_validation :snapshot_self_paced_support
  before_create :set_guided_access_terms
  before_create :set_enrolled_at
  before_create :set_invited_at
  after_create :assign_alumni_curriculum_modules, if: :active_alumni_enrollment?
  after_update :assign_alumni_curriculum_modules, if: :reactivated_alumni_enrollment?

  # Only a restart advances this token; unrelated access edits do not stale it.
  def restart_version
    learning_state_reset_at&.iso8601(6)
  end

  def with_learning_write_guard(request_started_at:)
    with_lock do
      if learning_state_reset_at.present? && request_started_at <= learning_state_reset_at
        raise StaleLearningWrite, "Your class progress was restarted while this request was in flight. Reload before saving again."
      end
      # A cohort copy (CurriculumCopyForCohort) moved this learner's lessons
      # to new ids while the request was in flight, so ids it read may be the
      # shared curriculum's. Nothing is lost: reload and save again.
      if content_moved_at.present? && request_started_at <= content_moved_at
        raise StaleLearningWrite.new(CONTENT_MOVED_MESSAGE, code: "content_moved")
      end

      yield
    end
  end

  def active?
    super && (access_expires_at.nil? || access_expires_at > Time.current)
  end

  def instructor_support_active?
    return false unless active?
    return support_expires_at.present? && support_expires_at > Time.current if cohort.self_paced?

    support_expires_at.nil? || support_expires_at > Time.current
  end

  def guided_help_available?
    !cohort.self_paced? && instructor_support_active?
  end

  # The day this learner's own course starts in a personal-pace cohort (W9.1):
  # a date staff set, otherwise the cohort start or the learner's first open,
  # whichever is later, so a late joiner starts when they arrive. Nil when the
  # cohort has no personal pace. Pass `in_cohort` when the caller holds it.
  def personal_start_on(in_cohort = cohort)
    return nil unless in_cohort.personal_pace?

    starts_on || [ in_cohort.start_date, first_opened_at&.in_time_zone(LearningCalendar::TIMEZONE)&.to_date ].compact.max
  end

  def record_first_course_open!
    return record_personal_first_open! if cohort.personal_release?
    return unless cohort.self_paced?

    with_lock do
      return unless active?

      update!(self_paced_support_weeks: cohort.self_paced_support_weeks) if self_paced_support_weeks.nil?
      return if first_opened_at.present?

      opened_at = Time.current
      update!(first_opened_at: opened_at, support_expires_at: [ opened_at + (self_paced_support_weeks || cohort.self_paced_support_weeks).weeks, access_expires_at ].compact.min)
      follow_first_open!
    end
  end

  # Guided personal-pace cohorts only need the date (support terms stay the
  # cohort's).
  #
  # The date and any re-plan it causes commit together under the row lock, so
  # a failed re-plan leaves the course unopened and the next open tries again.
  def record_personal_first_open!
    return if first_opened_at.present? || !active?

    with_lock do
      return if first_opened_at.present? || !active?

      update_columns(first_opened_at: Time.current, updated_at: Time.current)
      follow_first_open!
    end
  end

  # A pace chosen before the first open (by staff) was planned from the cohort
  # start. When the first open moves the start later, in any personal-pace
  # cohort, the plan moves with it. A start staff set is left alone; staff
  # module dates are still honored by the re-plan. Call inside this row's lock,
  # right after first_opened_at is set.
  def follow_first_open!
    return unless cohort.personal_pace? && starts_on.nil?
    return unless first_opened_at.in_time_zone(LearningCalendar::TIMEZONE).to_date > cohort.start_date
    return unless LearningPlan.where(enrollment_id: id, active: true, source: "learner_pace").exists?

    LearnerPace.new(self).regenerate!(actor: user)
  end

  def ensure_alumni_curriculum_modules!
    return unless active? && cohort.alumni?

    cohort.curriculum.modules.find_each do |curriculum_module|
      assignment = module_assignments.find_or_initialize_by(curriculum_module: curriculum_module)
      assignment.unlocked = true
      assignment.unlock_date_override = nil
      assignment.save!
    end
  end

  def assign_cohort_content_defaults!
    cohort.with_lock do
      cohort.initialize_content_defaults!
      cohort.curriculum.modules.each do |mod|
        defaults = cohort.content_defaults[mod.id.to_s]
        next unless defaults && defaults["assigned"]

        module_assignments.find_or_create_by!(curriculum_module: mod) do |assignment|
          assignment.unlocked = defaults["unlocked"]
          assignment.unlock_date_override = defaults["unlock_date_override"]
        end
      end
    end
  end

  def mark_joined!
    update_column(:joined_at, Time.current) if joined_at.nil?
  end

  private

  def starts_on_needs_personal_pace
    return unless will_save_change_to_starts_on? && starts_on.present?

    errors.add(:starts_on, "can only be set in a course with personal pace on") unless cohort&.personal_pace?
  end

  # Snapshot agreed terms for new guided enrollments. Editing cohort defaults
  # never shortens or extends an existing student's purchase automatically.
  def snapshot_self_paced_support
    self.self_paced_support_weeks ||= cohort.self_paced_support_weeks if cohort.self_paced?
  end

  def set_guided_access_terms
    return unless cohort.guided?

    anchor = personal_start_on || cohort.start_date || LearningCalendar.today
    access_end = cohort.guided_access_ends_on
    access_end ||= anchor + cohort.guided_access_months.months if cohort.guided_access_months
    self.access_expires_at ||= guided_date_boundary(access_end)

    support_end = guided_date_boundary(cohort.guided_support_ends_on)
    if !support_end && cohort.guided_support_weeks
      support_end = [ guided_date_boundary(anchor + cohort.guided_support_weeks.weeks), access_expires_at ].compact.min
    end
    self.support_expires_at ||= support_end
  end

  def guided_date_boundary(date)
    (date + 1).in_time_zone(LearningCalendar::TIMEZONE) if date
  end

  def set_enrolled_at
    self.enrolled_at ||= Time.current
  end

  def set_invited_at
    self.invited_at ||= Time.current
  end

  def active_alumni_enrollment?
    active? && cohort.alumni?
  end

  def reactivated_alumni_enrollment?
    saved_change_to_status? && active_alumni_enrollment?
  end

  def assign_alumni_curriculum_modules
    ensure_alumni_curriculum_modules!
  end
end

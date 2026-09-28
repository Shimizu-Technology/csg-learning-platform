class Cohort < ApplicationRecord
  ALUMNI_GITHUB_ORGANIZATION = "Code-School-of-Guam-Alumni".freeze

  enum :cohort_type, { bootcamp: 0, workshop: 1, alumni: 2, custom: 3 }
  enum :status, { upcoming: 0, active: 1, completed: 2, archived: 3 }

  belongs_to :curriculum
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

  validates :name, presence: true
  validates :start_date, presence: true
  validates :github_organization_name, format: { with: /\A[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\z/i }, allow_blank: true

  before_validation :normalize_github_organization_name
  before_validation :default_alumni_github_organization, on: :create
  after_create :provision_workspace
  after_update :complete_alumni_enrollments, if: :became_alumni?

  def module_schedule_for(curriculum_module)
    if cohort_module_schedules.loaded?
      cohort_module_schedules.find { |schedule| schedule.module_id == curriculum_module.id }
    else
      cohort_module_schedules.find_by(module_id: curriculum_module.id)
    end
  end

  def submission_window_for(module_id:, week_number:)
    if cohort_module_submission_windows.loaded?
      cohort_module_submission_windows.find { |window| window.module_id == module_id && window.week_number == week_number }
    else
      cohort_module_submission_windows.find_by(module_id: module_id, week_number: week_number)
    end
  end

  private

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
end

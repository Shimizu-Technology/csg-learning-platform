class GithubRepositoryBinding < ApplicationRecord
  belongs_to :enrollment
  belongs_to :curriculum_module, optional: true
  belongs_to :github_app_installation
  has_many :github_issue_deliveries, dependent: :nullify

  validates :full_name, format: { with: %r{\A[a-zA-Z0-9][a-zA-Z0-9-]{0,38}/[a-zA-Z0-9_.-]{1,100}\z}, message: "must be owner/repository" }
  validates :repository_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :verification_state, inclusion: { in: %w[pending verified failed] }
  validates :curriculum_module_id, uniqueness: { scope: :enrollment_id }
  validate :same_cohort_and_curriculum

  def identity_current?
    user = enrollment.user
    user.github_identity_verified? && github_user_id == user.github_user_id && github_username.present? && github_username.casecmp?(user.github_verified_login)
  end

  def fail_verification!(reason)
    update!(verification_state: "failed", failure_reason: reason, verified_at: nil, checked_at: Time.current)
  end

  private

  def same_cohort_and_curriculum
    return unless enrollment && github_app_installation

    errors.add(:github_app_installation, "must belong to the enrollment cohort") unless github_app_installation.cohort_id == enrollment.cohort_id
    if curriculum_module && curriculum_module.curriculum_id != enrollment.cohort.curriculum_id
      errors.add(:curriculum_module, "must belong to the cohort curriculum")
    end
  end
end

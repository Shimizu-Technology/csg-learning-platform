class ExerciseCheckPolicy < ApplicationRecord
  DEFAULT_ALLOWED_APP_SLUGS = [ "github-actions" ].freeze
  MAX_REQUIRED_CHECKS = 20
  MAX_ALLOWED_APP_SLUGS = 10
  SHA_PATTERN = /\A[0-9a-f]{40,64}\z/i
  SLUG_PATTERN = /\A[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\z/

  belongs_to :content_block
  belongs_to :created_by, class_name: "User", optional: true
  has_many :submission_grade_suggestions, dependent: :nullify

  scope :active, -> { where(active: true) }
  scope :newest_first, -> { order(version: :desc, id: :desc) }

  before_validation :normalize_fields

  validates :version, presence: true, numericality: { only_integer: true, greater_than: 0 }, uniqueness: { scope: :content_block_id }
  validates :active, inclusion: { in: [ true, false ] }
  validates :allowed_branch, length: { maximum: 255 }, allow_nil: true
  validates :expected_workflow_path, length: { maximum: 255 }, allow_nil: true
  validates :expected_workflow_sha, format: { with: SHA_PATTERN, message: "must be a 40-to-64 character hex SHA" }, allow_nil: true
  validate :required_checks_must_be_non_empty_string_array
  validate :allowed_app_slugs_must_be_non_empty_slug_array
  validate :expected_workflow_path_must_be_safe_relative_path

  # Atomically deactivates any prior active policy version on the block and
  # inserts a new incremented active version so policy history stays immutable.
  def self.create_version!(content_block:, required_checks:, allowed_app_slugs: nil, allowed_branch: nil,
    expected_workflow_path: nil, expected_workflow_sha: nil, created_by: nil)
    transaction do
      ContentBlock.lock("FOR NO KEY UPDATE").find(content_block.id)
      now = Time.current
      where(content_block_id: content_block.id, active: true).update_all(active: false, updated_at: now)
      next_version = where(content_block_id: content_block.id).maximum(:version).to_i + 1
      create!(
        content_block: content_block,
        version: next_version,
        active: true,
        required_checks: required_checks,
        allowed_app_slugs: allowed_app_slugs.nil? ? DEFAULT_ALLOWED_APP_SLUGS.dup : allowed_app_slugs,
        allowed_branch: allowed_branch,
        expected_workflow_path: expected_workflow_path,
        expected_workflow_sha: expected_workflow_sha,
        created_by: created_by
      )
    end
  end

  # Deactivates the currently active policy version without removing historical
  # versions referenced by prior submission_grade_suggestions.
  def self.deactivate_active!(content_block:)
    transaction do
      ContentBlock.lock("FOR NO KEY UPDATE").find(content_block.id)
      where(content_block_id: content_block.id, active: true).update_all(active: false, updated_at: Time.current)
    end
  end

  def to_staff_json
    {
      id: id,
      content_block_id: content_block_id,
      version: version,
      active: active,
      required_checks: required_checks,
      allowed_app_slugs: allowed_app_slugs,
      allowed_branch: allowed_branch,
      expected_workflow_path: expected_workflow_path,
      expected_workflow_sha: expected_workflow_sha,
      created_by_id: created_by_id,
      created_by_name: created_by&.full_name,
      created_at: created_at&.iso8601(6),
      updated_at: updated_at&.iso8601(6)
    }
  end

  private

  def normalize_fields
    if required_checks.is_a?(Array)
      self.required_checks = required_checks.map { |name| name.is_a?(String) ? name.strip : name }.reject { |name| name.is_a?(String) && name.empty? }.uniq
    end
    if allowed_app_slugs.is_a?(Array)
      self.allowed_app_slugs = allowed_app_slugs.map { |slug| slug.is_a?(String) ? slug.strip.downcase : slug }.reject { |slug| slug.is_a?(String) && slug.empty? }.uniq
    end
    self.allowed_branch = allowed_branch.strip.presence if allowed_branch.is_a?(String)
    self.expected_workflow_path = expected_workflow_path.strip.presence if expected_workflow_path.is_a?(String)
    self.expected_workflow_sha = expected_workflow_sha.strip.downcase.presence if expected_workflow_sha.is_a?(String)
  end

  def required_checks_must_be_non_empty_string_array
    unless required_checks.is_a?(Array) && required_checks.any?
      errors.add(:required_checks, "must contain at least one check name")
      return
    end
    if required_checks.size > MAX_REQUIRED_CHECKS
      errors.add(:required_checks, "cannot exceed #{MAX_REQUIRED_CHECKS} required checks")
    end
    unless required_checks.all? { |name| name.is_a?(String) && name.present? && name.length <= 255 }
      errors.add(:required_checks, "must contain only non-empty check names up to 255 characters")
    end
  end

  def allowed_app_slugs_must_be_non_empty_slug_array
    unless allowed_app_slugs.is_a?(Array) && allowed_app_slugs.any?
      errors.add(:allowed_app_slugs, "must contain at least one trusted GitHub App slug")
      return
    end
    if allowed_app_slugs.size > MAX_ALLOWED_APP_SLUGS
      errors.add(:allowed_app_slugs, "cannot exceed #{MAX_ALLOWED_APP_SLUGS} app slugs")
    end
    unless allowed_app_slugs.all? { |slug| slug.is_a?(String) && SLUG_PATTERN.match?(slug) }
      errors.add(:allowed_app_slugs, "must contain only valid GitHub App slugs")
    end
  end

  def expected_workflow_path_must_be_safe_relative_path
    return if expected_workflow_path.blank?

    if expected_workflow_path.start_with?("/") || expected_workflow_path.include?("\x00") ||
        expected_workflow_path.split("/").include?("..")
      errors.add(:expected_workflow_path, "must be a safe repository-relative path")
    end
  end
end

class ExerciseCheckPolicy < ApplicationRecord
  DEFAULT_ALLOWED_APP_SLUGS = [ "github-actions" ].freeze
  MAX_REQUIRED_CHECKS = 20
  MAX_ALLOWED_APP_SLUGS = 10
  # Accepts either a 40-char Git blob OID or a 64-char SHA-256 content digest.
  SHA_PATTERN = /\A(?:[0-9a-f]{40}|[0-9a-f]{64})\z/i
  SLUG_PATTERN = /\A[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\z/
  CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/

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
  validates :expected_workflow_sha, format: { with: SHA_PATTERN, message: "must be a 40-char Git blob OID or 64-char SHA-256 hex digest" }, allow_nil: true
  validate :content_block_must_be_exercise_like, if: :active?
  validate :required_checks_must_be_non_empty_string_array
  validate :allowed_app_slugs_must_be_non_empty_slug_array
  validate :allowed_branch_must_not_contain_control_characters
  validate :expected_workflow_path_must_be_safe_relative_path
  validate :expected_workflow_path_required_when_sha_set

  # Atomically deactivates any prior active policy version on the block and
  # inserts a new incremented active version so policy history stays immutable.
  def self.create_version!(content_block:, required_checks:, allowed_app_slugs: nil, allowed_branch: nil,
    expected_workflow_path: nil, expected_workflow_sha: nil, created_by: nil)
    transaction do
      locked_block = ContentBlock.lock("FOR NO KEY UPDATE").find(content_block.id)
      next_version = where(content_block_id: locked_block.id).maximum(:version).to_i + 1
      candidate = new(
        content_block: locked_block,
        version: next_version,
        active: true,
        required_checks: required_checks,
        allowed_app_slugs: allowed_app_slugs.nil? ? DEFAULT_ALLOWED_APP_SLUGS.dup : allowed_app_slugs,
        allowed_branch: allowed_branch,
        expected_workflow_path: expected_workflow_path,
        expected_workflow_sha: expected_workflow_sha,
        created_by: created_by
      )
      candidate.validate!

      where(content_block_id: locked_block.id, active: true).update_all(active: false, updated_at: Time.current)
      candidate.save!
      candidate
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

  # Trim only spaces and horizontal tabs so control characters (\r, \n, \x00)
  # survive normalization and are strictly rejected by validation (even for
  # control-only strings like "\n" or "\r" that ActiveSupport `.presence` would coerce to nil).
  def trim_horizontal_whitespace(value)
    value.gsub(/\A[ \t]+|[ \t]+\z/, "")
  end

  def normalize_optional_field(value, downcase: false)
    return value unless value.is_a?(String)
    return value if CONTROL_CHAR_PATTERN.match?(value)

    trimmed = trim_horizontal_whitespace(value)
    return nil if trimmed.empty?

    downcase ? trimmed.downcase : trimmed
  end

  def normalize_fields
    if required_checks.is_a?(Array)
      self.required_checks = required_checks.map { |name| name.is_a?(String) ? trim_horizontal_whitespace(name) : name }
        .reject { |name| name.is_a?(String) && name.empty? }
        .uniq
    end
    if allowed_app_slugs.is_a?(Array)
      self.allowed_app_slugs = allowed_app_slugs.map { |slug| slug.is_a?(String) ? trim_horizontal_whitespace(slug).downcase : slug }
        .reject { |slug| slug.is_a?(String) && slug.empty? }
        .uniq
    end
    self.allowed_branch = normalize_optional_field(allowed_branch)
    self.expected_workflow_path = normalize_optional_field(expected_workflow_path)
    self.expected_workflow_sha = normalize_optional_field(expected_workflow_sha, downcase: true)
  end

  def content_block_must_be_exercise_like
    return if content_block&.exercise_like?

    errors.add(:content_block, "must be an exercise or code challenge block")
  end

  def required_checks_must_be_non_empty_string_array
    unless required_checks.is_a?(Array) && required_checks.any?
      errors.add(:required_checks, "must contain at least one check name")
      return
    end
    if required_checks.size > MAX_REQUIRED_CHECKS
      errors.add(:required_checks, "cannot exceed #{MAX_REQUIRED_CHECKS} required checks")
    end
    unless required_checks.all? { |name| name.is_a?(String) && name.present? && name.length <= 255 && !CONTROL_CHAR_PATTERN.match?(name) }
      errors.add(:required_checks, "must contain only non-empty check names up to 255 characters without control characters")
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

  def allowed_branch_must_not_contain_control_characters
    return if allowed_branch.nil?

    if CONTROL_CHAR_PATTERN.match?(allowed_branch)
      errors.add(:allowed_branch, "must not contain control characters")
    end
  end

  def expected_workflow_path_must_be_safe_relative_path
    return if expected_workflow_path.nil?

    segments = expected_workflow_path.split("/", -1)
    unsafe = expected_workflow_path.start_with?("/") ||
      expected_workflow_path.end_with?("/") ||
      expected_workflow_path.include?("\\") ||
      expected_workflow_path.include?("//") ||
      CONTROL_CHAR_PATTERN.match?(expected_workflow_path) ||
      segments.any? { |segment| segment.empty? || segment == "." || segment == ".." }

    errors.add(:expected_workflow_path, "must be a safe repository-relative path") if unsafe
  end

  def expected_workflow_path_required_when_sha_set
    return if expected_workflow_sha.nil? || expected_workflow_path.present?

    errors.add(:expected_workflow_path, "is required when expected_workflow_sha is set")
  end
end

class GithubIssueDelivery < ApplicationRecord
  ACTIONS = %w[open_or_comment close].freeze
  GRADES = %w[A B C R].freeze
  STATUSES = %w[pending delivered failed obsolete].freeze
  MAX_ATTEMPTS = 5

  belongs_to :submission
  belongs_to :enrollment
  belongs_to :content_block
  belongs_to :github_repository_binding, optional: true

  validates :action, inclusion: { in: ACTIONS }
  validates :grade, inclusion: { in: GRADES }
  validates :status, inclusion: { in: STATUSES }
  validates :dedupe_token, presence: true, uniqueness: true
  validates :attempts, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :issue_number, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true

  scope :due, ->(now = Time.current) {
    where(status: "pending")
      .where("next_retry_at IS NULL OR next_retry_at <= ?", now)
      .where("claimed_until IS NULL OR claimed_until <= ?", now)
  }
  scope :active_outbox, -> { where(status: %w[pending failed]) }
  scope :delivered, -> { where(status: "delivered") }

  def pending? = status == "pending"
  def delivered? = status == "delivered"
  def failed? = status == "failed"
  def obsolete? = status == "obsolete"
  def claimed?(now = Time.current) = claimed_until.present? && claimed_until > now

  def marker
    "<!-- csg-delivery:#{dedupe_token} -->"
  end

  def to_staff_json
    {
      status: status,
      action: action,
      issue_url: issue_url,
      attempts: attempts,
      last_error: last_error,
      delivered_at: delivered_at&.iso8601(6),
      updated_at: updated_at.iso8601(6)
    }
  end
end

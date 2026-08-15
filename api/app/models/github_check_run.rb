class GithubCheckRun < ApplicationRecord
  CONCLUSIONS = %w[action_required cancelled failure neutral skipped stale startup_failure success timed_out].freeze
  STATUSES = %w[completed in_progress pending queued requested waiting].freeze

  belongs_to :submission

  validates :external_id, :name, :head_sha, :status, :fetched_at, presence: true
  validates :external_id, uniqueness: { scope: :submission_id }
  validates :status, inclusion: { in: STATUSES }
  validates :conclusion, inclusion: { in: CONCLUSIONS }, allow_nil: true
  validate :details_url_uses_https

  scope :current_for, ->(submission) { where(head_sha: submission.commit_sha) }
  scope :recent_first, -> { order(completed_at: :desc, started_at: :desc, id: :desc) }

  def passed?
    conclusion == "success"
  end

  def failed?
    %w[action_required failure startup_failure timed_out].include?(conclusion)
  end

  def pending?
    status != "completed"
  end

  private

  def details_url_uses_https
    return if details_url.blank?

    uri = URI.parse(details_url)
    errors.add(:details_url, "must use HTTPS") unless uri.is_a?(URI::HTTPS) && uri.host.present?
  rescue URI::InvalidURIError
    errors.add(:details_url, "must use HTTPS")
  end
end

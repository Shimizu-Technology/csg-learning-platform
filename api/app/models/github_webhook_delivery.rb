class GithubWebhookDelivery < ApplicationRecord
  PROCESSING_STATES = %w[pending processed staged ignored failed].freeze
  SUPPORTED_EVENTS = %w[check_run push installation installation_repositories].freeze
  RETENTION_STATES = %w[processed ignored].freeze
  DEFAULT_RETENTION_WINDOW = 30.days

  validates :delivery_id, :event, :processing_state, :received_at, presence: true
  validates :delivery_id, uniqueness: true
  validates :processing_state, inclusion: { in: PROCESSING_STATES }
  validates :attempts, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :installation_id, :repository_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validate :payload_must_be_object

  scope :pending, -> { where(processing_state: "pending") }
  scope :staged, -> { where(processing_state: "staged") }
  scope :for_repository_sha, ->(repository_id, head_sha) { where(repository_id: repository_id, head_sha: head_sha) }

  def self.prune_expired!(older_than: DEFAULT_RETENTION_WINDOW.ago)
    where(processing_state: RETENTION_STATES)
      .where("COALESCE(processed_at, received_at) < ?", older_than)
      .delete_all
  end

  def settled?
    %w[processed staged ignored].include?(processing_state)
  end

  private

  def payload_must_be_object
    errors.add(:payload, "must be a JSON object") unless payload.is_a?(Hash)
  end
end

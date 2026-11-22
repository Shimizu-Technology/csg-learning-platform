class GithubWebhookDelivery < ApplicationRecord
  PROCESSING_STATES = %w[pending processed staged ignored failed].freeze
  SUPPORTED_EVENTS = %w[check_run push installation installation_repositories].freeze
  RETENTION_STATES = %w[processed ignored].freeze
  UNSETTLED_RETENTION_STATES = %w[pending staged failed].freeze
  DEFAULT_RETENTION_WINDOW = 30.days
  UNSETTLED_RETENTION_WINDOW = 14.days
  PRUNE_BATCH_SIZE = 500
  TICK_MAX_BATCHES = 2

  validates :delivery_id, :event, :processing_state, :received_at, presence: true
  validates :delivery_id, uniqueness: true
  validates :processing_state, inclusion: { in: PROCESSING_STATES }
  validates :attempts, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :installation_id, :repository_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validate :payload_must_be_object

  scope :pending, -> { where(processing_state: "pending") }
  scope :staged, -> { where(processing_state: "staged") }
  scope :for_repository_sha, ->(repository_id, head_sha) { where(repository_id: repository_id, head_sha: head_sha) }

  def self.expired_scope(older_than: DEFAULT_RETENTION_WINDOW.ago, unsettled_older_than: UNSETTLED_RETENTION_WINDOW.ago)
    settled = where(processing_state: RETENTION_STATES)
      .where("COALESCE(processed_at, received_at) < ?", older_than)
    unsettled = where(processing_state: UNSETTLED_RETENTION_STATES)
      .where("received_at < ?", unsettled_older_than)
    settled.or(unsettled)
  end

  def self.prune_expired!(
    older_than: DEFAULT_RETENTION_WINDOW.ago,
    unsettled_older_than: UNSETTLED_RETENTION_WINDOW.ago,
    batch_size: PRUNE_BATCH_SIZE,
    max_batches: nil
  )
    deleted = 0
    batches = 0
    scope = expired_scope(older_than: older_than, unsettled_older_than: unsettled_older_than)

    loop do
      break if max_batches && batches >= max_batches

      ids = scope.order(:received_at, :id).limit(batch_size).pluck(:id)
      break if ids.empty?

      deleted += scope.where(id: ids).delete_all
      batches += 1
      break if ids.size < batch_size
    end

    deleted
  end

  def self.prune_preview(now: Time.current)
    limit = PRUNE_BATCH_SIZE * TICK_MAX_BATCHES
    count = expired_scope(
      older_than: now - DEFAULT_RETENTION_WINDOW,
      unsettled_older_than: now - UNSETTLED_RETENTION_WINDOW
    ).limit(limit).count
    { would_claim: count }
  end

  def self.prune_for_tick!(now: Time.current, metrics: {})
    pruned = prune_expired!(
      older_than: now - DEFAULT_RETENTION_WINDOW,
      unsettled_older_than: now - UNSETTLED_RETENTION_WINDOW,
      batch_size: PRUNE_BATCH_SIZE,
      max_batches: TICK_MAX_BATCHES
    )
    metrics[:claimed] = pruned
    pruned
  end

  def settled?
    %w[processed staged ignored].include?(processing_state)
  end

  private

  def payload_must_be_object
    errors.add(:payload, "must be a JSON object") unless payload.is_a?(Hash)
  end
end

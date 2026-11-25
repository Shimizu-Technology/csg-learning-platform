# A stored object whose deletion failed. ScheduledTick retries it with
# backoff; a key that is in use again, or already gone, is dropped.
class PendingS3Deletion < ApplicationRecord
  MAX_ATTEMPTS = 12
  FIRST_RETRY = 5.minutes
  DRAIN_LIMIT = 100

  validates :key, presence: true, length: { maximum: 1024 }
  validates :reason, presence: true, length: { maximum: 80 }

  scope :due, ->(now = Time.current) { where(next_attempt_at: ..now).where(attempts: ...MAX_ATTEMPTS) }

  # Never raises: callers are already handling a failed cleanup.
  def self.enqueue!(key, reason:)
    insert({ key: key, reason: reason, next_attempt_at: Time.current + FIRST_RETRY }, unique_by: :key)
    Rails.logger.warn("[PendingS3Deletion] enqueued reason=#{reason}")
    true
  rescue StandardError => error
    Rails.logger.error("[PendingS3Deletion] enqueue_failed reason=#{reason} #{error.class}")
    false
  end

  # Queues keys inside the caller's transaction, so they commit with the
  # rows that referenced them. Raises, rolling the caller back, on failure.
  # A key another deletion already queued is kept as it is.
  def self.enqueue_all!(keys, reason:, now: Time.current)
    rows = keys.compact_blank.uniq.map { |key| { key: key, reason: reason, next_attempt_at: now + FIRST_RETRY } }
    insert_all(rows, unique_by: :key) if rows.any?
  end

  # Tries queued keys right away (after their deleting transaction commits)
  # and clears each one that is gone, still in use, or not ours to delete.
  def self.attempt_now!(keys)
    keys.compact_blank.uniq.each do |key|
      next if S3ObjectCleanup.delete_unreferenced(key) == :failed

      where(key: key).delete_all
    end
  end

  def self.drain!(now: Time.current, metrics: {}, limit: DRAIN_LIMIT)
    metrics[:deleted] = metrics[:retrying] = 0
    return 0 unless S3Service.configured?

    due(now).order(:next_attempt_at, :id).limit(limit).each do |row|
      if S3ObjectCleanup.delete_unreferenced(row.key) == :failed
        attempts = row.attempts + 1
        row.update!(attempts: attempts, next_attempt_at: now + backoff(attempts), last_error: "delete failed (attempt #{attempts})")
        Rails.logger.error("[PendingS3Deletion] gave_up id=#{row.id} reason=#{row.reason}") if attempts >= MAX_ATTEMPTS
        metrics[:retrying] += 1
      else
        row.destroy!
        metrics[:deleted] += 1
      end
    end
    metrics[:deleted]
  end

  # 10 minutes, 20, 40 … capped at a day.
  def self.backoff(attempts)
    [ FIRST_RETRY * (2**attempts), 1.day ].min
  end
end

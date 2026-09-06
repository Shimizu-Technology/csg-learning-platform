class ExpoPushReceiptJob < ApplicationJob
  queue_as :default

  LOOKUP_DELAY = 15.minutes
  MAX_LOOKUPS = 2
  BATCH_SIZE = 1_000
  MAX_AGE = 24.hours
  PROCESSING_LEASE = 2.minutes

  retry_on ExpoPushReceiptService::RetryableError, wait: :polynomially_longer, attempts: 4
  discard_on ActiveJob::DeserializationError

  def self.track(receipt_requests)
    rows = Array(receipt_requests).filter_map do |request|
      receipt_id = request["receipt_id"].to_s
      token_id = request["mobile_push_token_id"].to_i
      next if receipt_id.blank? || !token_id.positive?

      now = Time.current
      {
        receipt_id: receipt_id,
        mobile_push_token_id: token_id,
        available_at: now + LOOKUP_DELAY,
        lookup_count: 0,
        created_at: now,
        updated_at: now
      }
    end
    return if rows.empty?

    ExpoPushReceipt.insert_all(rows, unique_by: :index_expo_push_receipts_on_receipt_id)
    set(wait: LOOKUP_DELAY).perform_later(rows.pluck(:receipt_id)) unless ActiveJob::Base.queue_adapter_name == "inline"
  rescue ActiveRecord::ActiveRecordError, ActiveJob::EnqueueError, NotImplementedError => e
    Rails.logger.warn("[ExpoPushReceiptJob] receipt tracking unavailable: #{e.class} #{e.message}")
  end

  def self.drain_due_inline
    return unless ActiveJob::Base.queue_adapter_name == "inline"

    new.drain_due
  rescue ExpoPushReceiptService::RetryableError, ExpoPushReceiptService::TerminalError => e
    defer_due_inline
    Rails.logger.warn("[ExpoPushReceiptJob] inline receipt check deferred: #{e.message}")
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.warn("[ExpoPushReceiptJob] inline receipt check deferred: #{e.message}")
  end

  def self.defer_due_inline
    ids = ExpoPushReceipt.due.limit(BATCH_SIZE).pluck(:id)
    return if ids.empty?

    ExpoPushReceipt.where(id: ids).update_all(available_at: Time.current + LOOKUP_DELAY, updated_at: Time.current)
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.warn("[ExpoPushReceiptJob] inline receipt backoff unavailable: #{e.message}")
  end

  def perform(receipt_ids = nil)
    retryable_ids = drain_due(receipt_ids)
    self.class.set(wait: LOOKUP_DELAY).perform_later(retryable_ids) if retryable_ids.any?
  end

  def drain_due(receipt_ids = nil)
    ExpoPushReceipt.where("created_at < ?", MAX_AGE.ago).delete_all
    receipts = claim_due(receipt_ids)
    return [] if receipts.empty?

    requests = receipts.map { |receipt| { "receipt_id" => receipt.receipt_id, "mobile_push_token_id" => receipt.mobile_push_token_id } }
    missing_ids = ExpoPushReceiptService.new.check(requests).pluck("receipt_id").index_with(true)
    resolved, missing = receipts.partition { |receipt| !missing_ids.include?(receipt.receipt_id) }
    claimed_scope(resolved).delete_all if resolved.any?

    retryable, exhausted = missing.partition { |receipt| receipt.lookup_count + 1 < MAX_LOOKUPS }
    if retryable.any?
      claimed_scope(retryable).update_all(
        available_at: Time.current + LOOKUP_DELAY,
        lookup_count: Arel.sql("lookup_count + 1"),
        processing_at: nil,
        processing_token: nil,
        updated_at: Time.current
      )
    end
    if exhausted.any?
      Rails.logger.warn("[ExpoPushReceiptJob] receipts unavailable after #{MAX_LOOKUPS} lookups receipt_ids=#{exhausted.map(&:receipt_id).join(',')}")
      claimed_scope(exhausted).delete_all
    end
    retryable.map(&:receipt_id)
  ensure
    release_claims(receipts)
  end

  private

  def claim_due(receipt_ids)
    now = Time.current
    claim_token = SecureRandom.uuid
    ids = ExpoPushReceipt.transaction do
      scope = ExpoPushReceipt
        .where(available_at: ..now)
        .where("processing_at IS NULL OR processing_at < ?", now - PROCESSING_LEASE)
      scope = scope.where(receipt_id: receipt_ids) if receipt_ids
      claimed_ids = scope.order(:available_at, :id).lock("FOR UPDATE SKIP LOCKED").limit(BATCH_SIZE).pluck(:id)
      ExpoPushReceipt.where(id: claimed_ids).update_all(processing_at: now, processing_token: claim_token, updated_at: now) if claimed_ids.any?
      claimed_ids
    end

    ExpoPushReceipt.where(id: ids, processing_token: claim_token).order(:available_at, :id).to_a
  end

  def claimed_scope(receipts)
    claimed = Array(receipts)
    ExpoPushReceipt.where(id: claimed.map(&:id), processing_token: claimed.first&.processing_token)
  end

  def release_claims(receipts)
    claimed = Array(receipts)
    claimed_scope(claimed).update_all(processing_at: nil, processing_token: nil) if claimed.any?
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.warn("[ExpoPushReceiptJob] receipt lease release unavailable: #{e.message}")
  end
end

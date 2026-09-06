class ExpoPushReceiptJob < ApplicationJob
  queue_as :default

  LOOKUP_DELAY = 15.minutes
  MAX_LOOKUPS = 2
  BATCH_SIZE = 1_000
  MAX_AGE = 24.hours

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
  rescue ExpoPushReceiptService::RetryableError, ActiveRecord::ActiveRecordError => e
    Rails.logger.warn("[ExpoPushReceiptJob] inline receipt check deferred: #{e.message}")
  end

  def perform(receipt_ids)
    retryable_ids = drain_due(receipt_ids)
    self.class.set(wait: LOOKUP_DELAY).perform_later(retryable_ids) if retryable_ids.any?
  end

  def drain_due(receipt_ids = nil)
    ExpoPushReceipt.where("created_at < ?", MAX_AGE.ago).delete_all
    scope = receipt_ids ? ExpoPushReceipt.where(receipt_id: receipt_ids) : ExpoPushReceipt.due
    receipts = scope.order(:available_at, :id).limit(BATCH_SIZE).to_a
    return [] if receipts.empty?

    requests = receipts.map { |receipt| { "receipt_id" => receipt.receipt_id, "mobile_push_token_id" => receipt.mobile_push_token_id } }
    missing_ids = ExpoPushReceiptService.new.check(requests).pluck("receipt_id").index_with(true)
    resolved, missing = receipts.partition { |receipt| !missing_ids.include?(receipt.receipt_id) }
    ExpoPushReceipt.where(id: resolved.map(&:id)).delete_all if resolved.any?

    retryable, exhausted = missing.partition { |receipt| receipt.lookup_count + 1 < MAX_LOOKUPS }
    if retryable.any?
      ExpoPushReceipt.where(id: retryable.map(&:id)).update_all(
        available_at: Time.current + LOOKUP_DELAY,
        lookup_count: Arel.sql("lookup_count + 1"),
        updated_at: Time.current
      )
    end
    if exhausted.any?
      Rails.logger.warn("[ExpoPushReceiptJob] receipts unavailable after #{MAX_LOOKUPS} lookups receipt_ids=#{exhausted.map(&:receipt_id).join(',')}")
      ExpoPushReceipt.where(id: exhausted.map(&:id)).delete_all
    end
    retryable.map(&:receipt_id)
  end
end

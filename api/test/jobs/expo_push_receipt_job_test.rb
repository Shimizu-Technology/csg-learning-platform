require "test_helper"

class ExpoPushReceiptJobTest < ActiveJob::TestCase
  include ActiveJob::TestHelper

  setup do
    user = User.create!(clerk_id: "expo_receipt_job_user", email: "expo-receipt-job@example.com", role: :student)
    @token = user.mobile_push_tokens.create!(token: "ExpoPushToken[receipt-job-device]", platform: "ios", last_seen_at: Time.current)
  end

  test "tracks accepted tickets durably and schedules their first lookup" do
    request = { "receipt_id" => "receipt-later", "mobile_push_token_id" => @token.id }

    assert_difference("ExpoPushReceipt.count", 1) do
      assert_enqueued_with(job: ExpoPushReceiptJob, args: [ [ "receipt-later" ] ], at: ->(time) { time.between?(14.minutes.from_now, 16.minutes.from_now) }) do
        ExpoPushReceiptJob.track([ request ])
      end
    end

    receipt = ExpoPushReceipt.last
    assert_equal "receipt-later", receipt.receipt_id
    assert_equal @token.id, receipt.mobile_push_token_id
    assert receipt.available_at.between?(14.minutes.from_now, 16.minutes.from_now)
  end

  test "checks due receipts and schedules one later lookup when a receipt is not ready" do
    receipt = create_receipt("receipt-later")
    service = Object.new
    service.define_singleton_method(:check) { |requests| requests }

    with_receipt_service(service) do
      assert_enqueued_with(job: ExpoPushReceiptJob, args: [ [ "receipt-later" ] ], at: ->(time) { time.between?(14.minutes.from_now, 16.minutes.from_now) }) do
        ExpoPushReceiptJob.perform_now([ "receipt-later" ])
      end
    end

    assert_equal 1, receipt.reload.lookup_count
    assert receipt.available_at.between?(14.minutes.from_now, 16.minutes.from_now)
  end

  test "duplicate jobs do not bypass the deferred retry time" do
    receipt = create_receipt("receipt-duplicate")
    calls = 0
    service = Object.new
    service.define_singleton_method(:check) do |requests|
      calls += 1
      requests
    end

    with_receipt_service(service) do
      ExpoPushReceiptJob.perform_now([ "receipt-duplicate" ])
      assert_no_enqueued_jobs(only: ExpoPushReceiptJob) do
        ExpoPushReceiptJob.perform_now([ "receipt-duplicate" ])
      end
    end

    assert_equal 1, calls
    assert_equal 1, receipt.reload.lookup_count
    assert receipt.available_at.future?
  end

  test "removes a receipt after its second unavailable lookup" do
    create_receipt("receipt-missing", lookup_count: 1)
    service = Object.new
    service.define_singleton_method(:check) { |requests| requests }

    with_receipt_service(service) do
      assert_no_enqueued_jobs(only: ExpoPushReceiptJob) { ExpoPushReceiptJob.perform_now([ "receipt-missing" ]) }
    end

    assert_not ExpoPushReceipt.exists?(receipt_id: "receipt-missing")
  end

  test "removes receipts that have a provider result" do
    create_receipt("receipt-ok")
    service = Object.new
    service.define_singleton_method(:check) { |_requests| [] }

    with_receipt_service(service) do
      assert_no_enqueued_jobs(only: ExpoPushReceiptJob) { ExpoPushReceiptJob.perform_now([ "receipt-ok" ]) }
    end

    assert_not ExpoPushReceipt.exists?(receipt_id: "receipt-ok")
  end

  test "recurring sweep processes every due receipt without explicit ids" do
    create_receipt("receipt-sweep")
    service = Object.new
    service.define_singleton_method(:check) { |_requests| [] }

    with_receipt_service(service) do
      assert_no_enqueued_jobs(only: ExpoPushReceiptJob) { ExpoPushReceiptJob.perform_now }
    end

    assert_not ExpoPushReceipt.exists?(receipt_id: "receipt-sweep")
  end

  test "inline delivery checks due receipts without enqueueing an unsupported delayed job" do
    service = Object.new
    service.define_singleton_method(:check) { |_requests| [] }
    original_adapter = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :inline
    request = { "receipt_id" => "receipt-inline", "mobile_push_token_id" => @token.id }

    assert_nothing_raised { ExpoPushReceiptJob.track([ request ]) }
    ExpoPushReceipt.find_by!(receipt_id: "receipt-inline").update!(available_at: 1.minute.ago)

    with_receipt_service(service) do
      assert_nothing_raised { ExpoPushReceiptJob.drain_due_inline }
    end

    assert_not ExpoPushReceipt.exists?(receipt_id: "receipt-inline")
  ensure
    ActiveJob::Base.queue_adapter = original_adapter if original_adapter
  end

  test "inline delivery backs off after a transient receipt lookup failure" do
    receipt = create_receipt("receipt-inline-retry")
    calls = 0
    service = Object.new
    service.define_singleton_method(:check) do |_requests|
      calls += 1
      raise ExpoPushReceiptService::RetryableError, "provider unavailable"
    end
    original_adapter = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :inline

    with_receipt_service(service) do
      assert_nothing_raised { ExpoPushReceiptJob.drain_due_inline }
      assert_nothing_raised { ExpoPushReceiptJob.drain_due_inline }
    end

    assert_equal 1, calls
    assert_equal 0, receipt.reload.lookup_count
    assert receipt.available_at.between?(14.minutes.from_now, 16.minutes.from_now)
  ensure
    ActiveJob::Base.queue_adapter = original_adapter if original_adapter
  end

  test "a terminal provider response preserves the receipt and releases its lease" do
    receipt = create_receipt("receipt-terminal")
    service = Object.new
    service.define_singleton_method(:check) do |_requests|
      raise ExpoPushReceiptService::TerminalError, "HTTP 401"
    end

    with_receipt_service(service) do
      assert_raises(ExpoPushReceiptService::TerminalError) do
        ExpoPushReceiptJob.perform_now([ "receipt-terminal" ])
      end
    end

    assert_nil receipt.reload.processing_at
    assert_equal 0, receipt.lookup_count
  end

  private

  def create_receipt(receipt_id, lookup_count: 0)
    ExpoPushReceipt.create!(
      mobile_push_token: @token,
      receipt_id: receipt_id,
      available_at: 1.minute.ago,
      lookup_count: lookup_count
    )
  end

  def with_receipt_service(service)
    original_new = ExpoPushReceiptService.method(:new)
    ExpoPushReceiptService.define_singleton_method(:new) { service }
    yield
  ensure
    ExpoPushReceiptService.define_singleton_method(:new, original_new) if original_new
  end
end

class ExpoPushReceiptJobConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    User.where(clerk_id: "expo_receipt_concurrency_user").destroy_all
    user = User.create!(clerk_id: "expo_receipt_concurrency_user", email: "expo-receipt-concurrency@example.com", role: :student)
    token = user.mobile_push_tokens.create!(token: "ExpoPushToken[receipt-concurrency-device]", platform: "ios", last_seen_at: Time.current)
    ExpoPushReceipt.create!(mobile_push_token: token, receipt_id: "receipt-concurrent", available_at: 1.minute.ago)
  end

  teardown do
    User.where(clerk_id: "expo_receipt_concurrency_user").destroy_all
  end

  test "overlapping workers claim a receipt only once" do
    started = Queue.new
    release = Queue.new
    calls = 0
    mutex = Mutex.new
    service = Object.new
    service.define_singleton_method(:check) do |_requests|
      mutex.synchronize { calls += 1 }
      started << true
      release.pop
      []
    end
    original_new = ExpoPushReceiptService.method(:new)
    ExpoPushReceiptService.define_singleton_method(:new) { service }

    first = Thread.new { ActiveRecord::Base.connection_pool.with_connection { ExpoPushReceiptJob.new.drain_due([ "receipt-concurrent" ]) } }
    started.pop
    second = Thread.new { ActiveRecord::Base.connection_pool.with_connection { ExpoPushReceiptJob.new.drain_due([ "receipt-concurrent" ]) } }

    begin
      assert second.join(1), "the second worker waited on a receipt already claimed by the first"
      assert_equal [], second.value
    ensure
      2.times { release << true }
      first.join
      second.join
      ExpoPushReceiptService.define_singleton_method(:new, original_new)
    end

    assert_equal 1, calls
    assert_equal [], first.value
    assert_not ExpoPushReceipt.exists?(receipt_id: "receipt-concurrent")
  end
end

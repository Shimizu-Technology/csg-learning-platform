require "test_helper"
require "stringio"
require_relative "../support/non_transactional_test_cleanup"

class ScheduledTickTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  setup do
    @log = StringIO.new
    @logger = ActiveSupport::Logger.new(@log)
    @calls = []
    @daily = ScheduledTick::Task.new(name: "daily_probe", daily_hour: 8, call: ->(now, last) { @calls << [ now, last ] })
    @hourly = ScheduledTick::Task.new(name: "hourly_probe", daily_hour: nil, call: ->(*) { @calls << :hourly })
  end

  test "daily work waits for school 8am, catches up after missed days and runs once per school day" do
    first = Time.utc(2026, 11, 16, 21, 59) # Nov 17 07:59 Guam
    assert tick(first, [ @daily ])
    assert_empty @calls
    assert tick(first + 1.minute, [ @daily ])
    assert tick(first + 3.hours, [ @daily ])
    assert_equal 1, @calls.size
    assert tick(first + 2.days + 1.minute, [ @daily ])
    assert_equal 2, @calls.size
    assert_equal Date.new(2026, 11, 17), @calls.last.last
    assert_equal Date.new(2026, 11, 19), ScheduledTaskRun.find_by!(name: @daily.name).last_school_date
  end

  test "Guam midnight advances the school date while UTC is still yesterday in winter and summer" do
    [ 1, 7 ].each do |month|
      daily = ScheduledTick::Task.new(name: "midnight_#{month}", daily_hour: 0, call: ->(*) { @calls << month })
      midnight = Time.utc(2026, month, 15, 14)
      assert tick(midnight - 1.second, [ daily ])
      assert tick(midnight, [ daily ])
      assert tick(midnight + 9.hours, [ daily ])
      assert_equal 2, @calls.count(month)
      assert_equal Date.new(2026, month, 16), ScheduledTaskRun.find_by!(name: daily.name).last_school_date
    end
  end

  test "daily cadence follows a DST zone's local 8am rather than 24 elapsed hours" do
    previous = Rails.application.config.x.school.time_zone
    Rails.application.config.x.school.time_zone = "America/New_York"
    assert tick(Time.utc(2026, 3, 7, 13), [ @daily ])
    assert tick(Time.utc(2026, 3, 8, 11, 59), [ @daily ])
    assert_equal 1, @calls.size
    assert tick(Time.utc(2026, 3, 8, 12), [ @daily ])
    assert_equal 2, @calls.size
  ensure
    Rails.application.config.x.school.time_zone = previous
  end

  test "hourly work is checkpointed once per slot and missed slots coalesce" do
    now = Time.utc(2026, 11, 17, 1)
    assert tick(now, [ @hourly ])
    assert tick(now + 59.minutes, [ @hourly ])
    assert_equal [ :hourly ], @calls
    assert tick(now + 3.hours, [ @hourly ])
    assert_equal [ :hourly, :hourly ], @calls
  end

  test "dry run reports due work without task calls or checkpoint writes" do
    assert_no_difference("ScheduledTaskRun.count") do
      assert tick(Time.utc(2026, 11, 17), [ @daily, @hourly ], dry_run: true)
    end
    assert_empty @calls
    assert_includes @log.string, '"status":"would_run"'
    assert_equal 1, @log.string.lines.size
  end

  test "a failing task leaves its checkpoint unchanged, runs the others and returns failure" do
    failing = ScheduledTick::Task.new(name: "failure_probe", daily_hour: nil, call: ->(*) { raise "provider unavailable" })
    assert_not tick(Time.utc(2026, 11, 17), [ failing, @hourly ])
    assert_nil ScheduledTaskRun.find_by!(name: failing.name).last_succeeded_at
    assert_equal "error", ScheduledTaskRun.find_by!(name: failing.name).last_result["status"]
    assert ScheduledTaskRun.find_by(name: @hourly.name)
    assert_equal [ :hourly ], @calls
    assert_includes @log.string, '"error":"RuntimeError"'
    assert_equal 1, @log.string.lines.size
  end

  test "cron registry excludes unsafe cross-process message recovery and needs no queue" do
    assert_equal %w[scheduled_updates intervention_follow_ups daily_unlocks expo_push_receipts learner_nudges github_webhook_retention], ScheduledTick::TASKS.map(&:name)
    original = ExpoPushReceiptJob.method(:new)
    probe = Object.new
    probe.define_singleton_method(:drain_due) { |**| [] }
    ExpoPushReceiptJob.define_singleton_method(:new) { probe }
    assert_no_enqueued_jobs { assert tick(Time.utc(2026, 11, 17), [ ScheduledTick::TASKS.find { |task| task.name == "expo_push_receipts" } ]) }
  ensure
    ExpoPushReceiptJob.define_singleton_method(:new, original) if original
  end

  test "scheduled follow-up push leaves receipt errors to the explicit receipt task" do
    original = ExpoPushReceiptJob.method(:drain_due_inline)
    calls = 0
    ExpoPushReceiptJob.define_singleton_method(:drain_due_inline) { calls += 1 }
    ExpoPushNotificationService.intervention_follow_ups([])
    assert_equal 0, calls
  ensure
    ExpoPushReceiptJob.define_singleton_method(:drain_due_inline, original) if original
  end

  private

  def tick(now, tasks, **options)
    ScheduledTick.new(now: now, tasks: tasks, logger: @logger, **options).call
  end
end

# Real committed connections: fixture-shared connections cannot model overlap.
class ScheduledTickOverlapTest < ActiveSupport::TestCase
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  test "overlapping ticks skip tasks and release their transaction lock" do
    calls = []
    task = ScheduledTick::Task.new(name: "overlap_probe", daily_hour: nil, call: ->(*) { calls << :called })
    log = StringIO.new
    logger = ActiveSupport::Logger.new(log)
    now = Time.utc(2026, 11, 17)
    thread = nil
    ScheduledTaskLockRecord.connection_pool.with_connection do |connection|
      connection.transaction do
        connection.execute("SELECT pg_advisory_xact_lock(#{ScheduledTick::LOCK_KEY})")
        thread = Thread.new do
          Rails.application.executor.wrap { ScheduledTick.new(now: now, tasks: [ task ], logger: logger).call }
        end
        assert thread.join(10), "overlapping tick must not wait on a lock"
        assert thread.value
        assert_empty calls
        assert_includes log.string, '"status":"overlap"'
      end
    end
    assert ScheduledTick.new(now: now, tasks: [ task ], logger: logger).call
    assert_equal [ :called ], calls
  ensure
    finish_test_threads(thread) if defined?(thread)
    ScheduledTaskRun.where(name: "overlap_probe").delete_all
  end
end

class ScheduledTickTest
  test "daily unlock schedule defaults to school 7am and can be configured" do
    assert_equal 7, ScheduledTick::TASKS.find { |task| task.name == "daily_unlocks" }.daily_hour
    previous = ENV["SCHEDULED_DAILY_UNLOCK_HOUR"]
    ENV["SCHEDULED_DAILY_UNLOCK_HOUR"] = "6"
    assert_equal 6, ScheduledTick.daily_unlock_hour
    ENV["SCHEDULED_DAILY_UNLOCK_HOUR"] = "24"
    assert_raises(ArgumentError) { ScheduledTick.daily_unlock_hour }
  ensure
    ENV["SCHEDULED_DAILY_UNLOCK_HOUR"] = previous
  end

  test "dry-run environment is case insensitive and fails closed for all other values" do
    [ "1", "true", "TRUE", "Yes", " yes " ].each { |value| assert ScheduledTick.dry_run("SCHEDULED_TICK_DRY_RUN" => value) }
    [ nil, "" ].each { |value| assert_not ScheduledTick.dry_run("SCHEDULED_TICK_DRY_RUN" => value) }
    [ " ", "0", "false", "no", "treu", "2" ].each do |value|
      assert_raises(ArgumentError) { ScheduledTick.dry_run("SCHEDULED_TICK_DRY_RUN" => value) }
    end
  end

  test "metrics persist on successful and failed attempts and status exposes them" do
    require "rake"
    task = ScheduledTick::Task.new(name: "metrics_probe", daily_hour: nil,
      call: ->(_now, _last, metrics) { metrics.merge!(claimed: 3, sent: 2, failed: 1); raise "provider failure" })
    assert_not tick(Time.utc(2026, 11, 17), [ task ])
    state = ScheduledTaskRun.find_by!(name: task.name)
    assert_nil state.last_succeeded_at
    assert_equal 3, state.last_result["claimed"]
    assert_equal 2, state.last_result["sent"]
    assert_equal 1, state.last_result["failed"]
    Rails.application.load_tasks unless Rake::Task.task_defined?("scheduled:status")
    output, = capture_io { Rake::Task["scheduled:status"].reenable; Rake::Task["scheduled:status"].invoke }
    row = JSON.parse(output).find { |entry| entry["name"] == task.name }
    assert_equal state.last_result, row["last_result"]
    assert_includes @log.string, '"catch_up_days":3'
  end

  test "github_webhook_retention prunes expired deliveries in bounded batches and supports dry run" do
    now = Time.utc(2026, 11, 22, 12, 0, 0)
    task = ScheduledTick::TASKS.find { |entry| entry.name == "github_webhook_retention" }

    old_settled = GithubWebhookDelivery.create!(delivery_id: "tick-old-settled", event: "check_run", processing_state: "processed", received_at: now - 35.days, processed_at: now - 31.days)
    old_staged = GithubWebhookDelivery.create!(delivery_id: "tick-old-staged", event: "push", processing_state: "staged", received_at: now - 16.days)
    old_failed = GithubWebhookDelivery.create!(delivery_id: "tick-old-failed", event: "check_run", processing_state: "failed", received_at: now - 15.days, last_error: "err")
    fresh_staged = GithubWebhookDelivery.create!(delivery_id: "tick-fresh-staged", event: "push", processing_state: "staged", received_at: now - 2.days)

    assert_no_difference "GithubWebhookDelivery.count" do
      assert tick(now, [ task ], dry_run: true)
    end
    assert_includes @log.string, '"would_claim":3'

    assert tick(now, [ task ])
    assert_not GithubWebhookDelivery.exists?(old_settled.id)
    assert_not GithubWebhookDelivery.exists?(old_staged.id)
    assert_not GithubWebhookDelivery.exists?(old_failed.id)
    assert GithubWebhookDelivery.exists?(fresh_staged.id)
    assert_equal 3, ScheduledTaskRun.find_by!(name: "github_webhook_retention").last_result["claimed"]

    # Empty next slot is a safe zero-claim no-op.
    assert tick(now + 2.hours, [ task ])
    assert_equal 0, ScheduledTaskRun.find_by!(name: "github_webhook_retention").last_result["claimed"]
  end

  test "Solid Queue recurring path invokes the same registry including daily unlocks" do
    require "fugit"
    config = YAML.safe_load(ERB.new(Rails.root.join("config/recurring.yml").read).result)
    assert_equal "ScheduledTickJob", config.dig("production", "scheduled_tick", "class")
    assert Fugit.parse(config.dig("production", "scheduled_tick", "schedule"))
    original = ScheduledTick.method(:new)
    called = 0
    probe = Object.new
    probe.define_singleton_method(:call) { called += 1; true }
    ScheduledTick.define_singleton_method(:new) { probe }
    ScheduledTickJob.perform_now
    assert_equal 1, called
  ensure
    ScheduledTick.define_singleton_method(:new, original) if original
  end
end

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
    @quarter = ScheduledTick::Task.new(name: "quarter_probe", daily_hour: nil, call: ->(*) { @calls << :quarter })
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

  test "quarter-hour work is checkpointed once per slot and missed slots coalesce" do
    now = Time.utc(2026, 11, 17, 1)
    assert tick(now, [ @quarter ])
    assert tick(now + 14.minutes, [ @quarter ])
    assert_equal [ :quarter ], @calls
    assert tick(now + 3.hours, [ @quarter ])
    assert_equal [ :quarter, :quarter ], @calls
  end

  test "dry run reports due work without task calls or checkpoint writes" do
    assert_no_difference("ScheduledTaskRun.count") do
      assert tick(Time.utc(2026, 11, 17), [ @daily, @quarter ], dry_run: true)
    end
    assert_empty @calls
    assert_includes @log.string, '"status":"would_run"'
    assert_equal 1, @log.string.lines.size
  end

  test "a failing task leaves its checkpoint unchanged, runs the others and returns failure" do
    failing = ScheduledTick::Task.new(name: "failure_probe", daily_hour: nil, call: ->(*) { raise "provider unavailable" })
    assert_not tick(Time.utc(2026, 11, 17), [ failing, @quarter ])
    assert_nil ScheduledTaskRun.find_by(name: failing.name)
    assert ScheduledTaskRun.find_by(name: @quarter.name)
    assert_equal [ :quarter ], @calls
    assert_includes @log.string, '"error":"RuntimeError"'
    assert_equal 1, @log.string.lines.size
  end

  test "cron registry excludes unsafe cross-process message recovery and needs no queue" do
    assert_equal %w[intervention_follow_ups daily_unlocks expo_push_receipts], ScheduledTick::TASKS.map(&:name)
    original = ExpoPushReceiptJob.method(:new)
    probe = Object.new
    probe.define_singleton_method(:drain_due) { [] }
    ExpoPushReceiptJob.define_singleton_method(:new) { probe }
    assert_no_enqueued_jobs { assert tick(Time.utc(2026, 11, 17), [ ScheduledTick::TASKS.last ]) }
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

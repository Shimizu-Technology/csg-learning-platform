class ScheduledTick
  LOCK_KEY = 4_853_480_000_000_001
  Task = Data.define(:name, :daily_hour, :call)
  TASKS = [
    Task.new(name: "intervention_follow_ups", daily_hour: 8, call: ->(now, _last_date) { InterventionFollowUpJob.perform_now(now) }),
    Task.new(name: "daily_unlocks", daily_hour: 0, call: ->(now, last_date) { DailyUnlockNotifications.new.call(now: now, last_date: last_date) }),
    # drain_due persists its own backoff; perform would enqueue a delayed job,
    # which the inline adapter cannot execute.
    Task.new(name: "expo_push_receipts", daily_hour: nil, call: ->(_now, _last_date) { ExpoPushReceiptJob.new.drain_due })
  ].freeze

  def initialize(now: Time.current, dry_run: false, tasks: TASKS, logger: Rails.logger)
    @now, @dry_run, @tasks, @logger = now, dry_run, tasks, logger
  end

  def call
    started = monotonic
    results = []
    success = true
    ScheduledTaskLockRecord.connection_pool.with_connection do |connection|
      connection.transaction do
        connection.execute("SET LOCAL idle_in_transaction_session_timeout = 0")
        locked = connection.uncached { connection.select_value("SELECT pg_try_advisory_xact_lock(#{LOCK_KEY})") }
        if locked
          @tasks.each do |task|
            result = run(task)
            results << result
            success = false if result[:status] == "error"
          end
        else
          results << { name: "tick", status: "overlap" }
        end
      end
    end
    success
  rescue StandardError, NotImplementedError => error
    results << { name: "tick", status: "error", error: error.class.name }
    false
  ensure
    @logger.info("[ScheduledTick] #{ { at: @now.iso8601, dry_run: @dry_run, tasks: results, duration_ms: ((monotonic - started) * 1000).round }.to_json }")
  end

  private

  def run(task)
    started = monotonic
    school_now = @now.in_time_zone(Rails.application.config.x.school.time_zone)
    school_date = school_now.to_date
    state = ScheduledTaskRun.find_by(name: task.name)
    due = if task.daily_hour
      school_now.hour >= task.daily_hour && (!state&.last_school_date || state.last_school_date < school_date)
    else
      !state&.last_succeeded_at || state.last_succeeded_at.to_i / 900 < @now.to_i / 900
    end
    status = due ? (@dry_run ? "would_run" : "run") : "skipped"
    if due && !@dry_run
      task.call.call(@now, state&.last_school_date)
      state ||= ScheduledTaskRun.new(name: task.name)
      state.update!(last_succeeded_at: @now, last_school_date: school_date)
    end
    { name: task.name, status: status, duration_ms: ((monotonic - started) * 1000).round }
  rescue StandardError, NotImplementedError => error
    { name: task.name, status: "error", error: error.class.name, duration_ms: ((monotonic - started) * 1000).round }
  end

  def monotonic = Process.clock_gettime(Process::CLOCK_MONOTONIC)
end

class ScheduledTick
  LOCK_KEY = 4_853_480_000_000_001
  Task = Data.define(:name, :daily_hour, :call)

  def self.daily_unlock_hour
    hour = Integer(ENV.fetch("SCHEDULED_DAILY_UNLOCK_HOUR", "7"), 10)
    raise ArgumentError, "SCHEDULED_DAILY_UNLOCK_HOUR must be 0..23" unless (0..23).cover?(hour)

    hour
  end

  def self.dry_run(environment = ENV)
    raw = environment["SCHEDULED_TICK_DRY_RUN"].to_s
    return false if raw.empty?

    value = raw.strip.downcase
    return true if %w[1 true yes].include?(value)

    raise ArgumentError, "SCHEDULED_TICK_DRY_RUN must be empty (real run), 1, true or yes"
  end

  TASKS = [
    # Hourly: scheduled updates go out at the first tick at or after their time (U-3.6).
    Task.new(name: "scheduled_updates", daily_hour: nil, call: ->(now, _last_date, metrics) { ScheduledAnnouncementPublisher.new.call(now: now, metrics: metrics) }),
    Task.new(name: "intervention_follow_ups", daily_hour: 8, call: ->(now, _last_date, metrics) { InterventionFollowUpJob.perform_now(now, metrics: metrics) }),
    Task.new(name: "daily_unlocks", daily_hour: daily_unlock_hour, call: ->(now, last_date, metrics) { DailyUnlockNotifications.new.call(now: now, last_date: last_date, metrics: metrics) }),
    Task.new(name: "expo_push_receipts", daily_hour: nil, call: ->(_now, _last_date, metrics) { ExpoPushReceiptJob.new.drain_due(metrics: metrics) }),
    # Hourly, so a 24h or 48h reminder lands within the hour it becomes due;
    # it sends nothing 21:00-08:00 Guam time (W9.3).
    Task.new(name: "learner_nudges", daily_hour: nil, call: ->(now, _last_date, metrics) { LearnerNudges.new.call(now: now, metrics: metrics) })
  ].freeze

  def initialize(now: Time.current, dry_run: self.class.dry_run, tasks: TASKS, logger: Rails.logger)
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
          results << { name: "tick", status: "overlap", claimed: 0, sent: 0, failed: 0 }
        end
      end
    end
    success
  rescue StandardError, NotImplementedError => error
    results << { name: "tick", status: "error", error: error.class.name }
    false
  ensure
    @logger.info("[ScheduledTick] #{ { at: @now.iso8601, dry_run: @dry_run, catch_up_days: DailyUnlockNotifications::CATCH_UP_DAYS, tasks: results, duration_ms: ((monotonic - started) * 1000).round }.to_json }")
  end

  private

  def run(task)
    started = monotonic
    metrics = { claimed: 0, sent: 0, failed: 0 }
    school_now = @now.in_time_zone(Rails.application.config.x.school.time_zone)
    state = ScheduledTaskRun.find_by(name: task.name)
    due = if task.daily_hour
      school_now.hour >= task.daily_hour && (!state&.last_school_date || state.last_school_date < school_now.to_date)
    else
      !state&.last_succeeded_at || state.last_succeeded_at.to_i / 3600 < @now.to_i / 3600
    end
    status = due ? (@dry_run ? "would_run" : "run") : "skipped"
    metrics.merge!(preview(task, state)) if @dry_run
    if due && !@dry_run
      # Existing two-argument extension callables remain supported.
      arguments = [ @now, state&.last_school_date, metrics ]
      task.call.call(*arguments.take(task.call.arity == 2 ? 2 : 3))
    end
    result = { name: task.name, status: status, **metrics, duration_ms: ((monotonic - started) * 1000).round }
    record_result(task, state, result, succeeded: due) unless @dry_run || !due
    result
  rescue StandardError, NotImplementedError => error
    result = { name: task.name, status: "error", **metrics, error: error.class.name, duration_ms: ((monotonic - started) * 1000).round }
    begin
      record_result(task, state, result, succeeded: false) unless @dry_run
    rescue StandardError
      # A failed checkpoint must not prevent the remaining tasks from running.
    end
    result
  end

  def preview(task, state)
    case task.name
    when "intervention_follow_ups" then InterventionFollowUpJob.preview(@now)
    when "daily_unlocks" then DailyUnlockNotifications.new.preview(now: @now, last_date: state&.last_school_date)
    when "scheduled_updates" then ScheduledAnnouncementPublisher.preview(@now)
    when "expo_push_receipts" then { would_claim: ExpoPushReceipt.due.limit(ExpoPushReceiptJob::BATCH_SIZE).count }
    when "learner_nudges" then LearnerNudges.preview(@now)
    else {}
    end
  end

  def record_result(task, state, result, succeeded:)
    state ||= ScheduledTaskRun.new(name: task.name)
    attributes = { last_attempted_at: @now, last_result: result }
    attributes.merge!(last_succeeded_at: @now, last_school_date: @now.in_time_zone(Rails.application.config.x.school.time_zone).to_date) if succeeded
    state.update!(attributes)
  end

  def monotonic = Process.clock_gettime(Process::CLOCK_MONOTONIC)
end

namespace :scheduled do
  desc "Run due scheduled work once (SCHEDULED_TICK_DRY_RUN=1 reports without writes or sends)"
  task tick: :environment do
    abort "Scheduled tick failed; inspect [ScheduledTick] summary" unless ScheduledTick.new(dry_run: ScheduledTick.dry_run).call
  end

  desc "Report each scheduled task's last successful tick and school date"
  task status: :environment do
    puts ScheduledTaskRun.order(:name).as_json(only: %i[name last_succeeded_at last_school_date last_attempted_at last_result]).to_json
  end
end

namespace :scheduled do
  desc "Report old follow-ups; with Leon's approval set CONFIRM_FOLLOW_UP_BASELINE to mark them without sending"
  task baseline_follow_ups: :environment do
    activation = Time.iso8601(ENV.fetch("SCHEDULED_ACTIVATION_AT"))
    days = Integer(ENV.fetch("SCHEDULED_FOLLOW_UP_MAX_AGE_DAYS"), 10)
    confirmation = ENV["CONFIRM_FOLLOW_UP_BASELINE"].presence
    puts ScheduledFollowUpActivation.call(activation_at: activation, older_than_days: days, confirmation: confirmation).to_json
  end
end

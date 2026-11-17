namespace :scheduled do
  desc "Run due scheduled work once (SCHEDULED_TICK_DRY_RUN=1 reports without writes or sends)"
  task tick: :environment do
    abort "Scheduled tick failed; inspect [ScheduledTick] summary" unless ScheduledTick.new(dry_run: ENV["SCHEDULED_TICK_DRY_RUN"] == "1").call
  end

  desc "Report each scheduled task's last successful tick and school date"
  task status: :environment do
    puts ScheduledTaskRun.order(:name).pluck(:name, :last_succeeded_at, :last_school_date).to_json
  end
end

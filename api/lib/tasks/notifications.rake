namespace :notifications do
  desc "Run daily unlocks using scheduled:tick locking and checkpoints"
  task send_daily_unlocks: :environment do
    task = ScheduledTick::TASKS.find { |entry| entry.name == "daily_unlocks" }
    abort "Daily unlock task failed" unless ScheduledTick.new(tasks: [ task ], dry_run: ENV["SCHEDULED_TICK_DRY_RUN"] == "1").call
  end
end

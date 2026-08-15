require "json"
require "time"

namespace :operations do
  desc "Report unfinished Solid Queue jobs created before STALE_QUEUE_CUTOFF"
  task stale_queue_report: :environment do
    backlog = StaleQueueBacklog.new(cutoff: stale_queue_cutoff!)
    puts JSON.pretty_generate(backlog.report)
  end

  desc "Discard ready Solid Queue jobs before STALE_QUEUE_CUTOFF (confirmation required)"
  task purge_stale_queue: :environment do
    expected_confirmation = "delete-ready-jobs-before-cutoff"
    unless ENV["CONFIRM_STALE_QUEUE_PURGE"] == expected_confirmation
      abort "Set CONFIRM_STALE_QUEUE_PURGE=#{expected_confirmation} after reviewing operations:stale_queue_report"
    end

    backlog = StaleQueueBacklog.new(cutoff: stale_queue_cutoff!)
    puts JSON.pretty_generate(backlog.report)
    deleted = backlog.purge_ready!
    puts "Discarded #{deleted} stale ready jobs."
  end
end

def stale_queue_cutoff!
  raw_cutoff = ENV.fetch("STALE_QUEUE_CUTOFF")
  Time.iso8601(raw_cutoff)
rescue KeyError
  abort "Set STALE_QUEUE_CUTOFF to an ISO 8601 timestamp."
rescue ArgumentError
  abort "STALE_QUEUE_CUTOFF must be a valid ISO 8601 timestamp."
end

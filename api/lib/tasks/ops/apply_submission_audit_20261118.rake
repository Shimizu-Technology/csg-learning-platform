require_relative "../../ops/apply_submission_audit_20261118"

namespace :ops do
  desc "Apply Leon's 2026-11-18 submission audit decisions (dry run unless APPLY=1)"
  task apply_submission_audit_20261118: :environment do
    apply = ENV["APPLY"] == "1" && ENV.fetch("DRY_RUN", "0") == "0"
    baseline = JSON.parse(File.read(ENV.fetch("AUDIT_BASELINE")))
    result = Ops::ApplySubmissionAudit20261118.new(
      admin: User.find_by(id: ENV.fetch("ADMIN_USER_ID")), baseline: baseline, apply: apply
    ).run
    abort "Refused decisions; inspect JSON report" if result[:counts].fetch("refused", 0).positive?
  rescue Ops::ApplySubmissionAudit20261118::Refused, KeyError, JSON::ParserError, Errno::ENOENT, ArgumentError => error
    counts = { applied: 0, skipped: 0, refused: 1 }
    puts "Summary: #{counts.to_json}"
    puts JSON.generate(counts: counts, error: error.message)
    abort "Invalid audit input; no decisions applied"
  end
end

require_relative "../../ops/submission_audit_baseline_20261118"

namespace :ops do
  desc "Read-only export of the 99 approved audit blocks, rejecting updates after CUTOFF"
  task export_submission_audit_baseline: :environment do
    result = Ops::SubmissionAuditBaseline20261118.new(cutoff: ENV.fetch("CUTOFF")).run
    abort "Baseline export refused; inspect all offenders" if result[:refused]
  rescue KeyError, ArgumentError => error
    puts JSON.generate(refused: true, error: error.message)
    abort "Invalid export input"
  end
end

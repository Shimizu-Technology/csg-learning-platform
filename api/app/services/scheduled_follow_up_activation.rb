# Operator-only one-time activation baseline. No sends and no notification rows.
class ScheduledFollowUpActivation
  CONFIRMATION = "mark-old-follow-ups-without-sending".freeze

  def self.call(activation_at:, older_than_days:, confirmation: nil)
    raise ArgumentError, "older_than_days must be positive" unless older_than_days.positive?

    cutoff = activation_at - older_than_days.days
    scope = InterventionFollowUpJob.pending(activation_at).where("next_follow_up_at < ?", cutoff)
    report = { activation_at: activation_at.iso8601, older_than_days: older_than_days, cutoff: cutoff.iso8601, candidates: scope.count, marked: 0 }
    return report if confirmation.nil?

    raise ArgumentError, "Invalid activation confirmation" unless confirmation == CONFIRMATION

    # Re-evaluate eligibility in the UPDATE: concurrent edits of due dates
    # cannot mark a newly scheduled future follow-up as notified.
    report[:marked] = scope.update_all(follow_up_notified_at: activation_at, updated_at: Time.current)
    report
  end
end

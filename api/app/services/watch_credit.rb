# Clients report cumulative media seconds, never permission to complete. Allow
# at most 2 media seconds per server second, with a one-time 25-second bootstrap
# for legacy players' first 10-second post. Background gaps have no upper limit.
# Discard excess reports (including legacy ended promotion); identical replays
# earn nothing. Carry only fractional seconds, never a per-request grace grant.
# The caller holds the enrollment write lock, serializing all progress writes.
class WatchCredit
  def self.apply(progress, stored:, reported:, duration:, now: Time.current)
    reported = reported.to_i.clamp(0, 2_147_483_647)
    previous = progress.watch_reported_total
    baseline = previous && reported >= previous ? [ stored, previous ].max : stored
    elapsed = progress.watch_credit_at ? [ now - progress.watch_credit_at, 0 ].max : nil
    budget = elapsed ? elapsed * 2 + progress.watch_credit_fraction : 25.0
    delta = [ [ reported - baseline, 0 ].max, budget.floor ].min
    progress.watch_credit_at = now
    progress.watch_reported_total = reported
    progress.watch_credit_fraction = budget - budget.floor
    total = stored + delta
    duration&.positive? ? [ total, [ stored, duration ].max ].min : total
  end
end

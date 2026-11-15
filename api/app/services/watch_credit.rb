# Clients report cumulative media seconds, never permission to complete.
# Start with 20 tokens, refill at 2.5x server time since the last accepted post,
# retain up to 20 unused tokens after debit. Idle refill is uncapped for all
# clients, preserving installed players' background playback and PiP support.
# The version marker is client-asserted telemetry only.
# Watch credit is an engagement signal, not tamper-proof. A determined student
# can forge progress after idle time on any client. The server bound stops
# over-crediting from bugs, replays and large instant jumps on recently active
# rows: grants since the first save cannot exceed 2.5x elapsed server time + 20.
# Stored totals stay monotonic and clamped to duration; sessions are never zeroed
# or rejected. The enrollment write lock serializes updates.
class WatchCredit
  BUCKET_CAP = 20.0
  REFILL_RATE = 2.5

  def self.apply(progress, stored:, reported:, duration:, version: nil, now: Time.current)
    reported = reported.to_i.clamp(0, 2_147_483_647)
    elapsed = progress.watch_credit_at ? [ now - progress.watch_credit_at, 0 ].max : nil
    budget = elapsed.nil? ? BUCKET_CAP : elapsed * REFILL_RATE + progress.watch_credit_fraction
    delta = [ [ reported - stored, 0 ].max, budget.floor ].min
    progress.watch_credit_at = now
    # This existing column now holds whole tokens as well as fractions.
    progress.watch_credit_fraction = [ budget - delta, BUCKET_CAP ].min
    total = stored + delta
    duration&.positive? ? [ total, [ stored, duration ].max ].min : total
  end
end

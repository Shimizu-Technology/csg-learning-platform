# Clients report cumulative media seconds, never permission to complete.
# Start with 20 tokens, refill at 2.5x server time, retain 20 unused tokens.
# Marked clients cap the available budget at 120 media seconds before debit.
# The version marker is client-asserted telemetry, NOT an anti-forgery control.
# Installed native players enable background playback/PiP, so unmarked clients
# keep uncapped idle refill: one forged post after long idle can complete a row.
# Every client is bounded by 2.5 x elapsed server time + 20 since its first save;
# only marked clients additionally have a 120-second per-save bound. Omitting the
# marker bypasses that burst cap. The enrollment write lock serializes updates.
class WatchCredit
  BUCKET_CAP = 20.0
  IDLE_CAP = 120.0
  REFILL_RATE = 2.5

  def self.apply(progress, stored:, reported:, duration:, version: nil, now: Time.current)
    reported = reported.to_i.clamp(0, 2_147_483_647)
    elapsed = progress.watch_credit_at ? [ now - progress.watch_credit_at, 0 ].max : nil
    budget = elapsed.nil? ? BUCKET_CAP : elapsed * REFILL_RATE + progress.watch_credit_fraction
    budget = [ budget, IDLE_CAP ].min if version.to_i >= 2
    delta = [ [ reported - stored, 0 ].max, budget.floor ].min
    progress.watch_credit_at = now
    # This existing column now holds whole tokens as well as fractions.
    progress.watch_credit_fraction = [ budget - delta, BUCKET_CAP ].min
    total = stored + delta
    duration&.positive? ? [ total, [ stored, duration ].max ].min : total
  end
end

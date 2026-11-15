# Clients report cumulative media seconds, never permission to complete.
# Carry up to 20 unused media seconds between saves, replenished at 2x server
# time. Keep outstanding reports recoverable (including installed clients whose
# counters clamp at duration). The enrollment write lock serializes updates.
# Version 2 caps idle gaps over 30s to 20 media seconds. Unmarked installed
# clients retain uncapped idle refill for background playback compatibility:
# a forged post after a long idle can still complete a legacy row. Remove this
# exception when those installed builds age out.
class WatchCredit
  BUCKET_CAP = 20.0
  IDLE_SECONDS = 30

  def self.apply(progress, stored:, reported:, duration:, version: nil, now: Time.current)
    reported = reported.to_i.clamp(0, 2_147_483_647)
    elapsed = progress.watch_credit_at ? [ now - progress.watch_credit_at, 0 ].max : nil
    budget = if elapsed.nil? || (version.to_i >= 2 && elapsed > IDLE_SECONDS)
      BUCKET_CAP
    else
      elapsed * 2 + progress.watch_credit_fraction
    end
    delta = [ [ reported - stored, 0 ].max, budget.floor ].min
    progress.watch_credit_at = now
    progress.watch_reported_total = reported
    # This existing column now holds whole tokens as well as fractions.
    progress.watch_credit_fraction = [ budget - delta, BUCKET_CAP ].min
    total = stored + delta
    duration&.positive? ? [ total, [ stored, duration ].max ].min : total
  end
end

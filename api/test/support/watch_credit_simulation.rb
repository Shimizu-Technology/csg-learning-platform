# Seeded arrival simulator adapted from the independent PR #249 round-2 review.
module WatchCreditSimulation
  extend self
  Progress = Struct.new(:watch_credit_at, :watch_credit_fraction)

  def latency(rng)
    l = 0.15 + -Math.log(1 - rng.rand) * 0.25
    u = rng.rand
    l += 1 + rng.rand * 5 if u < 0.08
    l += 6 + rng.rand * 19 if u >= 0.08 && u < 0.10
    failed = rng.rand < 0.02
    [ l, failed ]
  end

  # Return accepted credit as a fraction of video duration.
  def completion(client:, rate:, seed:, scenario:, dur: 1800)
    rng = Random.new(seed)
    version = client.to_s.start_with?("new") ? 2 : nil
    native = client.to_s.end_with?("native")
    clamp = client == :old_native
    promote = client.to_s.start_with?("old")
    # wall timeline with optional pauses
    pauses = []
    if scenario == :pauses
      3.times { |i| pauses << [ (dur / rate) * (i + 1) / 4.0 + rng.rand * 20, 60 + rng.rand * 60 ] }
    end
    outage = scenario == :outage ? (s = (dur / rate) * (0.25 + rng.rand * 0.25); [ s, s + 45 ]) : nil
    sends = [] # [t, reported, ended]
    t = 0.0; media = 0.0; last_save = 0.0; tick = native ? 1.0 : 0.25
    next_interval = 10.0
    pi = 0
    while media < dur
      if pauses[pi] && t >= pauses[pi][0]
        sends << [ t, media, false ]            # pause save
        t += pauses[pi][1]
        next_interval = t + 10                 # web interval restarts on play
        pi += 1
        next
      end
      t += tick
      media = [ media + tick * rate, dur ].min
      if native
        if t - last_save >= 10 then last_save = t; sends << [ t, media, false ] end
      else
        if t >= next_interval - 1e-9 then next_interval += 10; sends << [ t, media, false ] end
      end
    end
    sends << [ t, media, true ]
    # network
    arrivals = []
    busy_until = 0.0
    if native
      # serialized drain: latest pending payload replaces earlier while in flight
      queue = sends.dup
      while (s = queue.shift)
        st = [ s[0], busy_until ].max
        # if later sends occurred before st, they replace this one
        while queue.first && queue.first[0] <= st
          s = queue.shift
          st = [ s[0], busy_until ].max
        end
        l, f = latency(rng)
        f ||= outage && st >= outage[0] && st <= outage[1]
        busy_until = st + l
        arrivals << [ st + l, s[1], s[2] ] unless f
      end
    else
      sends.each do |s|
        l, f = latency(rng)
        f ||= outage && s[0] >= outage[0] && s[0] <= outage[1]
        arrivals << [ s[0] + l, s[1], s[2] ] unless f
      end
    end
    arrivals.sort_by!(&:first)
    p = Progress.new(nil, 0.0); stored = 0
    arrivals.each do |at, m, ended|
      rep = m.floor
      rep = [ rep, dur ].min if clamp
      rep = [ rep, dur ].max if ended && promote
      stored = WatchCredit.apply(p, stored: stored, reported: rep, duration: dur, version: version, now: at)
    end
    stored.to_f / dur
  end
end

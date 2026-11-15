require "test_helper"
require_relative "../support/watch_credit_simulation"

class WatchCreditTest < ActiveSupport::TestCase
  test "legacy web and native posting patterns remain credited at half through double speed" do
    [ :web, :native ].each do |client|
      [ 0.5, 1, 1.5, 2 ].each do |rate|
        progress = WatchProgress.new
        stored = 0
        reported = 0
        clock = Time.current
        # play post, periodic posts, background resume, pause, foreground, ended
        [ 0, 10, 10, 120, 0, 10 ].each do |wall|
          media = wall * rate
          credited = if client == :web
            [ media, [ 2, wall * rate + 0.5 ].max ].min
          else
            media <= wall * [ rate, 1 ].max + 0.75 ? media : 0
          end
          reported += credited
          clock += wall
          result = WatchCredit.apply(progress, stored: stored, reported: reported, duration: 1000, now: clock)
          assert_equal reported, result, "#{client} at #{rate}x after #{wall}s"
          stored = result
        end
        promoted = WatchCredit.apply(progress, stored: stored, reported: 1000, duration: 1000, now: clock)
        assert_operator promoted - stored, :<=, WatchCredit::BUCKET_CAP
      end
    end
  end

  test "jitter and latency tails preserve completion including failed first saves" do
    [ :web, :native ].product([ 0.5, 1, 1.5, 2 ], [ nil, 2 ], [ false, true ]).each do |client, rate, version, failed_first|
      200.times do |seed|
        random = Random.new(seed)
        progress = WatchProgress.new
        start = Time.current
        stored = 0
        arrival = start
        media = 0
        (1..(300 / (10 * rate)).ceil).each do |tick|
          media = [ tick * 10 * rate, 300 ].min
          next if failed_first && tick <= 2
          latency = (tick.odd? ? 0.5 : 0) + (random.rand < 0.1 ? random.rand * 3 : 0)
          arrival = start + tick * 10 + latency
          report = client == :native ? [ media, 300 ].min : media
          stored = WatchCredit.apply(progress, stored: stored, reported: report, duration: 300, version: version, now: arrival)
        end
        stored = WatchCredit.apply(progress, stored: stored, reported: media, duration: 300, version: version, now: arrival + 10)
        assert_operator stored, :>=, 270, "#{client} #{rate}x v#{version} seed #{seed} first failed #{failed_first}"
      end
    end
  end

  test "alternating 9.5 and 10.5 second arrivals recover all 300 seconds" do
    progress = WatchProgress.new
    start = Time.current
    stored = 0
    15.times do |i|
      arrival = start + (i + 1) * 10 + (i.even? ? 0.5 : 0)
      stored = WatchCredit.apply(progress, stored: stored, reported: (i + 1) * 20, duration: 300, now: arrival)
    end
    assert_equal 300, stored
  end

  test "legacy counter stalled at duration recovers" do
    progress = WatchProgress.new(watch_credit_at: Time.current)
    assert_equal 120, WatchCredit.apply(progress, stored: 102, reported: 120, duration: 120, now: progress.watch_credit_at + 10)
  end

  test "marked idle capped at 120 and installed background resume preserved" do
    [ nil, 2 ].each do |version|
      progress = WatchProgress.new(watch_credit_at: 120.seconds.ago, watch_credit_fraction: 20)
      stored = WatchCredit.apply(progress, stored: 10, reported: 250, duration: 300, version: version)
      assert_equal(version ? 130 : 250, stored)
    end
  end

  test "forged totals and replay remain bounded by server time plus cap" do
    progress = WatchProgress.new
    clock = Time.current
    stored = WatchCredit.apply(progress, stored: 0, reported: 10000, duration: 1000, version: 2, now: clock)
    assert_equal 20, stored
    100.times do |i|
      stored = WatchCredit.apply(progress, stored: stored, reported: 10000, duration: 1000, version: 2, now: clock + (i + 1) * 0.1)
      assert_operator stored, :<=, 20 + 2.5 * (i + 1) * 0.1
    end
    assert_equal stored, WatchCredit.apply(progress, stored: stored, reported: -1, duration: 1000, now: clock + 11)
  end

  test "seeded latency tails outages and pauses preserve completion for every client" do
    samples = ENV.fetch("WATCH_CREDIT_SEEDS", "20").to_i
    [ 300, 600, 1800 ].product([ :old_web, :old_native, :new_web, :new_native ], [ 1, 2 ], [ :tail, :outage, :pauses ]).each do |duration, client, rate, scenario|
      samples.times do |seed|
        completion = WatchCreditSimulation.completion(client: client, rate: rate, seed: seed, scenario: scenario, dur: duration)
        assert_operator completion, :>=, 0.9, "#{duration}s #{client} #{rate}x #{scenario} seed #{seed}"
      end
    end
  end

  test "two failed saves and 45 second outage at double speed recover for every client" do
    [ nil, 2 ].product([ :web, :native ], [ 35, 45 ]).each do |version, client, gap|
      progress = WatchProgress.new
      clock = Time.current
      stored = WatchCredit.apply(progress, stored: 0, reported: 20, duration: 600, version: version, now: clock)
      wall = 10 + gap
      while wall <= 300
        report = [ wall * 2, 600 ].min
        stored = WatchCredit.apply(progress, stored: stored, reported: report, duration: 600, version: version, now: clock + wall - 10)
        wall += 10
      end
      stored = WatchCredit.apply(progress, stored: stored, reported: 600, duration: 600, version: version, now: clock + 300)
      assert_equal 600, stored, "#{client} v#{version} gap #{gap}"
    end
  end

  test "marked forged single post after long idle is capped at 120" do
    progress = WatchProgress.new(watch_credit_at: 1.hour.ago, watch_credit_fraction: 20)
    assert_equal 120, WatchCredit.apply(progress, stored: 0, reported: 10000, duration: 10000, version: 2)
  end
end

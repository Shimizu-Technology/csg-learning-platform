require "test_helper"

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
    progress = WatchProgress.new(watch_credit_at: Time.current, watch_reported_total: 120)
    assert_equal 120, WatchCredit.apply(progress, stored: 102, reported: 120, duration: 120, now: progress.watch_credit_at + 10)
  end

  test "marked idle capped and installed background resume preserved" do
    [ nil, 2 ].each do |version|
      progress = WatchProgress.new(watch_credit_at: 120.seconds.ago, watch_credit_fraction: 20)
      stored = WatchCredit.apply(progress, stored: 10, reported: 250, duration: 300, version: version)
      assert_equal(version ? 30 : 250, stored)
    end
  end

  test "forged totals and replay remain bounded by server time plus cap" do
    progress = WatchProgress.new
    clock = Time.current
    stored = WatchCredit.apply(progress, stored: 0, reported: 10000, duration: 1000, version: 2, now: clock)
    assert_equal 20, stored
    100.times do |i|
      stored = WatchCredit.apply(progress, stored: stored, reported: 10000, duration: 1000, version: 2, now: clock + (i + 1) * 0.1)
      assert_operator stored, :<=, 20 + 2 * (i + 1) * 0.1
    end
    assert_equal stored, WatchCredit.apply(progress, stored: stored, reported: -1, duration: 1000, now: clock + 11)
  end
end

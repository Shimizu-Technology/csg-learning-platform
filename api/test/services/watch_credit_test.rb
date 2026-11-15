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
        assert_equal stored, promoted, "ended promotion cannot bypass clock"
      end
    end
  end

  test "forged totals, immediate replay and rounding cannot mint credit" do
    progress = WatchProgress.new
    clock = Time.current
    stored = WatchCredit.apply(progress, stored: 0, reported: 10000, duration: 1000, now: clock)
    assert_equal 25, stored
    10.times do
      clock += 0.1
      stored = WatchCredit.apply(progress, stored: stored, reported: 10000, duration: 1000, now: clock)
    end
    assert_equal 25, stored
    stored = WatchCredit.apply(progress, stored: stored, reported: 10001, duration: 1000, now: clock + 10)
    assert_equal 26, stored
    assert_equal stored, WatchCredit.apply(progress, stored: stored, reported: -1, duration: 1000, now: clock + 11)
  end
end

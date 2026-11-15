require "test_helper"
require "open3"
require "fugit"

class SchoolTimeTest < ActiveSupport::TestCase
  test "defaults to Guam and validates the boot configuration" do
    assert_equal "Pacific/Guam", SchoolTime.configure[:time_zone]
    assert_equal "ChST", SchoolTime.configure[:time_zone_label]
    error = assert_raises(ArgumentError) { SchoolTime.configure("Mars/Olympus") }
    assert_match "Invalid SCHOOL_TIME_ZONE", error.message
  end

  test "another environment zone drives calendar boundaries and model defaults at boot" do
    script = <<~RUBY
      require_relative "config/environment"
      require "fugit"
      abort unless LearningCalendar::TIMEZONE == "America/New_York"
      abort unless LearningCalendar.today(at: Time.utc(2026, 4, 6, 3, 59)) == Date.new(2026, 4, 5)
      abort unless LearningCalendar.today(at: Time.utc(2026, 4, 6, 4)) == Date.new(2026, 4, 6)
      hour = OfficeHour.new(starts_at: "2026-04-06T18:00:00-04:00", ends_at: "2026-04-06T19:00:00-04:00")
      abort unless hour.timezone == "America/New_York"
      abort unless hour.upcoming_occurrences(from: Time.utc(2026, 4, 6)).first[:starts_at].in_time_zone(hour.timezone).hour == 18
      abort unless PrivateMeetingConfig.new.timezone == "America/New_York"
      config = YAML.safe_load(ERB.new(Rails.root.join("config/recurring.yml").read).result)
      cron = Fugit.parse(config.dig("production", "intervention_follow_ups", "schedule"))
      abort unless cron.next_time(Time.utc(2026, 4, 6)).utc == Time.utc(2026, 4, 6, 12)
    RUBY
    output, status = Open3.capture2e({ "SCHOOL_TIME_ZONE" => "America/New_York" }, "bundle", "exec", "ruby", "-e", script, chdir: Rails.root)
    assert status.success?, output
  end

  test "invalid environment zone fails at application boot" do
    output, status = Open3.capture2e({ "SCHOOL_TIME_ZONE" => "Mars/Olympus" }, "bundle", "exec", "ruby", "-e", 'require_relative "config/environment"', chdir: Rails.root)
    assert_not status.success?
    assert_match "Invalid SCHOOL_TIME_ZONE", output
  end

  test "recurring YAML evaluates the configured school zone" do
    config = YAML.safe_load(ERB.new(Rails.root.join("config/recurring.yml").read).result)
    cron = Fugit.parse(config.dig("production", "intervention_follow_ups", "schedule"))
    assert cron
    assert_equal Time.utc(2026, 4, 6, 22), cron.next_time(Time.utc(2026, 4, 6)).utc
  end
end

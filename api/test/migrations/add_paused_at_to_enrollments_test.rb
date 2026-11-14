require "test_helper"
require Rails.root.join("db/migrate/20261114160000_add_paused_at_to_enrollments").to_s

class AddPausedAtToEnrollmentsTest < ActiveSupport::TestCase
  test "legacy paused rows get a separate fixed cutoff without an invented pause date" do
    curriculum = Curriculum.create!(name: "Legacy cutoff")
    cohort = Cohort.create!(curriculum: curriculum, name: "Legacy", start_date: Date.current)
    enrollments = %i[active paused dropped completed].map do |status|
      user = User.create!(clerk_id: "legacy_#{status}", email: "legacy-#{status}@example.com", role: :student)
      Enrollment.create!(user: user, cohort: cohort, status: status)
    end
    timestamp = 3.days.ago.change(usec: 0)
    enrollments.each { |enrollment| enrollment.update_columns(paused_at: nil, read_cutoff_at: nil, updated_at: timestamp) }
    paused = enrollments.find(&:paused?)
    migration = AddPausedAtToEnrollments.new
    2.times do
      migration.migrate(:down)
      refute Enrollment.connection.column_exists?(:enrollments, :paused_at)
      refute Enrollment.connection.column_exists?(:enrollments, :read_cutoff_at)
      migration.migrate(:up)
      Enrollment.reset_column_information
      enrollments.each do |enrollment|
        enrollment.reload
        assert_nil enrollment.paused_at
        assert_equal timestamp, enrollment.read_cutoff_at if enrollment.paused?
        assert_nil enrollment.read_cutoff_at unless enrollment.paused?
      end
    end
    paused.update!(support_expires_at: 1.month.from_now)
    migration.migrate(:up)
    assert_equal timestamp, paused.reload.read_cutoff_at
    assert_nil paused.paused_at
    assert_nil paused.pause_date
    refute paused.content_available_for_read?(1.day.ago)
    paused.update!(status: :active)
    paused.update!(status: :paused)
    real_pause = paused.paused_at
    migration.migrate(:up)
    assert_equal real_pause, paused.reload.paused_at
    assert_equal timestamp, paused.read_cutoff_at
  ensure
    Enrollment.reset_column_information
  end
end

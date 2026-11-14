require "test_helper"
require Rails.root.join("db/migrate/20261114160000_add_paused_at_to_enrollments").to_s

class AddPausedAtToEnrollmentsTest < ActiveSupport::TestCase
  test "legacy paused rows get one fixed cutoff from updated_at" do
    curriculum = Curriculum.create!(name: "Legacy cutoff")
    cohort = Cohort.create!(curriculum: curriculum, name: "Legacy", start_date: Date.current)
    user = User.create!(clerk_id: "legacy_pause", email: "legacy-pause@example.com", role: :student)
    enrollment = Enrollment.create!(user: user, cohort: cohort, status: :paused)
    timestamp = 3.days.ago.change(usec: 0)
    enrollment.update_columns(paused_at: nil, updated_at: timestamp)
    migration = AddPausedAtToEnrollments.new
    migration.migrate(:down)
    migration.migrate(:up)
    Enrollment.reset_column_information
    assert_equal timestamp, enrollment.reload.paused_at
    enrollment.update!(support_expires_at: 1.month.from_now)
    assert_equal timestamp, enrollment.reload.paused_at
  ensure
    Enrollment.reset_column_information
  end
end

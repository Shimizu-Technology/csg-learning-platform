require "test_helper"
require Rails.root.join("db/migrate/20261118060000_record_staff_reliability_state").to_s

class RecordStaffReliabilityStateTest < ActiveSupport::TestCase
  test "legacy paused libraries are backfilled once without changing dates or timestamps" do
    curriculum = Curriculum.create!(name: "Frozen library")
    mod = curriculum.modules.create!(name: "History", position: 0, schedule_days: "daily")
    cohort = Cohort.create!(name: "Frozen", curriculum: curriculum, start_date: 1.month.ago.to_date)
    lesson = mod.lessons.create!(title: "Old", position: 0, release_day: 0, created_at: 1.month.ago)
    student = User.create!(clerk_id: "frozen_migration", email: "frozen-migration@example.invalid", role: :student)
    enrollment = Enrollment.create!(user: student, cohort: cohort)
    assignment = enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    assignment.update_columns(created_at: 1.month.ago, availability_changed_at: 1.month.ago)
    enrollment.update_columns(status: Enrollment.statuses[:paused], paused_at: nil, read_cutoff_at: 1.week.ago.change(usec: 0), paused_lesson_ids: nil)
    timestamps = enrollment.reload.attributes.slice("updated_at", "paused_at", "read_cutoff_at")
    migration = RecordStaffReliabilityState.new
    migration.migrate(:down)
    Enrollment.reset_column_information
    Announcement.reset_column_information
    2.times { migration.migrate(:up) }
    Enrollment.reset_column_information
    assert_equal [ lesson.id ], enrollment.reload.paused_lesson_ids
    assert_equal timestamps, enrollment.attributes.slice("updated_at", "paused_at", "read_cutoff_at")
    assert_nil enrollment.paused_at
    original = enrollment.paused_lesson_ids
    assignment.update!(unlock_date_override: 1.year.from_now.to_date, unlocked: false)
    cohort.update!(start_date: 1.year.from_now.to_date)
    migration.migrate(:up)
    assert_equal original, enrollment.reload.paused_lesson_ids
    assert enrollment.lesson_available_for_read?(lesson, assignment, nil)
    assert LessonReadAccess.lookup(student, lesson.id, cohort_id: cohort.id).allowed?
    enrollment.update!(status: :active)
    assert_nil enrollment.paused_lesson_ids
    assert_nil enrollment.paused_library_cutoff_at
    refute enrollment.lesson_available_for_read?(lesson, assignment, nil)
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Enrollment.reset_column_information
    Announcement.reset_column_information
  end
end

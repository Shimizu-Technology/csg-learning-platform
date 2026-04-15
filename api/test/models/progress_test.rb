require "test_helper"

class ProgressTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Test Curriculum")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Lesson 1", position: 0, release_day: 0)
    @block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 0, title: "Ex 1", body: "Do it"
    )
    @student = User.create!(
      clerk_id: "clerk_progress_test", email: "progress_test@example.com", role: :student
    )
  end

  test "sets completed_at when status changes to completed" do
    progress = Progress.create!(user: @student, content_block: @block, status: :not_started)
    assert_nil progress.completed_at

    progress.update!(status: :completed)
    assert_not_nil progress.completed_at
  end

  test "clears completed_at when status changes away from completed" do
    progress = Progress.create!(user: @student, content_block: @block, status: :completed)
    assert_not_nil progress.completed_at

    progress.update!(status: :in_progress)
    assert_nil progress.completed_at
  end

  test "does not overwrite completed_at if already set" do
    frozen_time = Time.utc(2026, 1, 1, 12, 0, 0)
    progress = Progress.create!(user: @student, content_block: @block, status: :completed)
    progress.update_column(:completed_at, frozen_time)

    progress.reload
    progress.update!(status: :completed)
    assert_equal frozen_time, progress.completed_at
  end

  test "enforces uniqueness of content_block per user" do
    Progress.create!(user: @student, content_block: @block, status: :not_started)
    duplicate = Progress.new(user: @student, content_block: @block, status: :not_started)
    refute duplicate.valid?
    assert_includes duplicate.errors[:content_block_id], "has already been taken"
  end

  test "enum values" do
    progress = Progress.create!(user: @student, content_block: @block, status: :not_started)
    assert progress.not_started?

    progress.update!(status: :in_progress)
    assert progress.in_progress?

    progress.update!(status: :completed)
    assert progress.completed?
  end
end

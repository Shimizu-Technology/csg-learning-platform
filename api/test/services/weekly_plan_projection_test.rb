require "test_helper"

class WeeklyPlanProjectionTest < ActiveSupport::TestCase
  def setup
    @now = Time.utc(2030, 7, 10, 2, 0, 0) # Wednesday noon in Guam.
    @curriculum = Curriculum.create!(name: "Weekly Plan Curriculum")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Foundations",
      position: 0,
      day_offset: 0,
      schedule_days: "daily",
      module_type: :live_class
    )
    @monday = create_lesson("Monday setup", 0, required: true)
    @wednesday = create_lesson("Wednesday project", 2, required: true)
    @friday_optional = create_lesson("Friday stretch", 4, required: false)
    @next_monday = create_lesson("Next week", 7, required: true)

    @student = User.create!(clerk_id: "weekly_student", email: "weekly@example.com", first_name: "Weekly", last_name: "Student", role: :student)
    @instructor = User.create!(clerk_id: "weekly_instructor", email: "weekly-instructor@example.com", first_name: "Weekly", last_name: "Instructor", role: :instructor)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Weekly", start_date: Date.new(2030, 7, 8), status: :active)
    @cohort.cohort_module_schedules.create!(curriculum_module: @mod, start_date: Date.new(2030, 7, 8))
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: Time.utc(2030, 7, 13, 13))
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)

    Progress.create!(user: @student, content_block: @monday.content_blocks.first, status: :completed)
    Submission.create!(user: @student, content_block: @wednesday.content_blocks.first, grade: :R, feedback: "Try the layout again.", graded_at: @now - 1.hour)
    @cohort.office_hours.create!(
      title: "Live class",
      starts_at: Time.utc(2030, 7, 10, 4),
      ends_at: Time.utc(2030, 7, 10, 6),
      meeting_url: "https://meet.example.com/live",
      timezone: "Pacific/Guam",
      recurrence: :once,
      event_kind: :live_class,
      created_by: @instructor
    )
    @recording = @cohort.recordings.create!(
      title: "Monday replay",
      s3_key: "recordings/cohort_#{@cohort.id}/20300708090000_abcdef12_monday.mp4",
      content_type: "video/mp4",
      file_size: 1.megabyte,
      position: 1,
      status: :published,
      recorded_date: Date.new(2030, 7, 8)
    )
  end

  test "projects one shared student week with required, optional, support, and catch-up work" do
    plan = WeeklyPlanProjection.new(@student, now: @now).call

    assert plan[:enrolled]
    assert_equal Date.new(2030, 7, 8), plan[:starts_on]
    assert_equal Date.new(2030, 7, 14), plan[:ends_on]
    assert_equal 1, plan[:week_number]
    assert_equal({ required_count: 2, required_completed_count: 1, open_redo_count: 1, optional_count: 1 }, plan[:summary])
    assert_equal %w[completed open], plan[:required].map { |item| item[:state] }
    assert_equal "upcoming", plan[:optional].first[:state]
    assert_equal "redo", plan[:redos].first[:kind]
    assert_equal "live_class", plan[:events].first[:kind]
    assert_equal @recording.id, plan[:recording_catch_up].first[:recording_id]
    assert_equal [ @friday_optional.id, @next_monday.id ], plan[:upcoming_unlocks].map { |item| item[:lesson_id] }
  end

  test "returns an explicit empty enrollment projection" do
    unenrolled = User.create!(clerk_id: "weekly_unenrolled", email: "weekly-unenrolled@example.com", first_name: "No", last_name: "Cohort", role: :student)

    assert_equal({ enrolled: false, timezone: "Pacific/Guam" }, WeeklyPlanProjection.new(unenrolled, now: @now).call)
  end

  test "does not put draft recordings in student catch-up work" do
    @recording.update!(status: :draft)

    plan = WeeklyPlanProjection.new(@student, now: @now).call

    assert_empty plan[:recording_catch_up]
  end

  private

  def create_lesson(title, release_day, required:)
    lesson = Lesson.create!(curriculum_module: @mod, title: title, position: release_day, release_day: release_day, required: required, lesson_type: :exercise)
    lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "#{title} work", submission_type: :text_submission)
    lesson
  end
end

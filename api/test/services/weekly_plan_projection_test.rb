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
    @monday.content_blocks.create!(block_type: :video, position: 1, title: "Monday recording", video_url: "https://www.youtube.com/watch?v=example")

    @student = User.create!(clerk_id: "weekly_student", email: "weekly@example.com", first_name: "Weekly", last_name: "Student", role: :student)
    @instructor = User.create!(clerk_id: "weekly_instructor", email: "weekly-instructor@example.com", first_name: "Weekly", last_name: "Instructor", role: :instructor)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Weekly", start_date: Date.new(2030, 7, 8), status: :active)
    @cohort.cohort_module_schedules.create!(curriculum_module: @mod, start_date: Date.new(2030, 7, 8))
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: Time.utc(2030, 7, 13, 13))
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)

    Progress.create!(user: @student, enrollment: @enrollment, content_block: @monday.content_blocks.first, status: :completed)
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @wednesday.content_blocks.first, grade: :R, feedback: "Try the layout again.", graded_at: @now - 1.hour)
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
    assert_equal @wednesday.content_blocks.first.id, plan[:redos].first[:content_block_id]
    assert_equal @cohort.id, plan[:recording_catch_up].first[:cohort_id]
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

  test "projects alumni enrollment as an open learning library instead of weekly assignments" do
    @cohort.update!(cohort_type: :alumni)

    plan = WeeklyPlanProjection.new(@student, now: @now).call

    assert plan[:enrolled]
    assert_equal "library", plan[:mode]
    assert_equal({ module_count: 1, lesson_count: 4, recording_count: 1 }, plan[:library_summary])
    assert_nil plan[:week_number]
    assert_nil plan[:summary]
    assert_nil plan[:required]
    assert_nil plan[:optional]
    assert_equal "live_class", plan[:events].first[:kind]
    assert_equal @recording.id, plan[:recording_catch_up].first[:recording_id]
  end

  test "counts recorded lessons instead of cohort recording rows for alumni" do
    @cohort.update!(cohort_type: :alumni)
    @cohort.recordings.create!(
      title: "Extra cohort replay",
      s3_key: "recordings/cohort_#{@cohort.id}/20300709090000_abcdef12_extra.mp4",
      content_type: "video/mp4",
      file_size: 1.megabyte,
      position: 2,
      status: :published
    )

    plan = WeeklyPlanProjection.new(@student, now: @now).call

    assert_equal 1, plan.dig(:library_summary, :recording_count)
  end

  test "alumni retain library mode regardless of delivery setting" do
    @cohort.update!(cohort_type: :alumni, course_delivery: "self_paced")

    plan = WeeklyPlanProjection.new(@student, now: @now).call
    assert_equal "library", plan[:mode]
    assert_equal 4, plan.dig(:library_summary, :lesson_count)
    assert_empty plan[:events]
    assert plan.key?(:capabilities)
  end

  test "lesson-only assignments appear under their module without siblings or sibling redos" do
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @wednesday, unlocked: true)
    @enrollment.lesson_assignments.create!(lesson: @next_monday, unlock_date_override: Date.new(2030, 7, 15))

    plan = WeeklyPlanProjection.new(@student, now: @now).call
    assert_equal [ @wednesday.id ], plan[:required].map { |item| item[:lesson_id] }
    assert_equal @mod.id, plan[:required].first[:module_id]
    assert_empty plan[:optional]
    assert_equal [ @next_monday.id ], plan[:upcoming_unlocks].map { |item| item[:lesson_id] }
    assert_equal 1, plan[:summary][:required_count]

    @cohort.update!(course_delivery: "self_paced")
    course = WeeklyPlanProjection.new(@student, now: @now).call
    assert_equal "self_paced", course[:mode]
    assert_equal @wednesday.id, course.dig(:next_lesson, :lesson_id)
    assert_equal [ @wednesday.id ], course[:redos].map { |item| item[:lesson_id] }
  end

  test "self-paced overview retains latest redos without promising class meetings" do
    @cohort.update!(course_delivery: "self_paced", support_instructor: @instructor)
    # Complete every block in the first lesson so the course resumes at the next one.
    @monday.content_blocks.each do |block|
      Progress.find_or_create_by!(user: @student, enrollment: @enrollment, content_block: block).update!(status: :completed)
    end

    plan = WeeklyPlanProjection.new(@student, now: @now).call
    assert_equal "self_paced", plan[:mode]
    assert_equal @curriculum.name, plan[:course_name]
    assert_equal({ lesson_id: @wednesday.id, title: @wednesday.title, module_id: @mod.id }, plan[:next_lesson])
    assert_equal [ @wednesday.id ], plan[:redos].map { |item| item[:lesson_id] }
    assert_equal "course_question", plan.dig(:capabilities, :support_mode)
    assert_empty plan[:events]
    assert_nil plan[:library_summary]
    assert_nil plan[:week_number]

    Submission.create!(user: @student, enrollment: @enrollment, content_block: @wednesday.content_blocks.first, text: "Revised work")
    assert_empty WeeklyPlanProjection.new(@student, now: @now).call[:redos]
  end

  test "self-paced overview has no next lesson when all assigned work is complete" do
    @cohort.update!(course_delivery: "self_paced")
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @wednesday, unlocked: true)
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @wednesday.content_blocks.first, status: :completed)

    plan = WeeklyPlanProjection.new(@student, now: @now).call
    assert_nil plan[:next_lesson]
    assert_equal [ @wednesday.id ], plan[:redos].map { |item| item[:lesson_id] }
  end

  test "individually unlocked future lessons are current work, while undated manual locks invent no opening date" do
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @next_monday, unlocked: true, created_at: @now)
    @enrollment.lesson_assignments.create!(lesson: @monday, unlocked: false)
    plan = WeeklyPlanProjection.new(@student, now: @now).call
    assert_equal [ @next_monday.id ], plan[:required].map { |item| item[:lesson_id] }
    assert_equal @now.in_time_zone("Pacific/Guam").to_date, plan[:required].first[:scheduled_for]
    assert_equal "open", plan[:required].first[:state]
    assert_empty plan[:upcoming_unlocks]
  end

  private

  def create_lesson(title, release_day, required:)
    lesson = Lesson.create!(curriculum_module: @mod, title: title, position: release_day, release_day: release_day, required: required, lesson_type: :exercise)
    lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "#{title} work", submission_type: :text_submission)
    lesson
  end
end

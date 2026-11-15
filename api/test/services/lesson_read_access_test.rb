require "test_helper"

# LessonReadAccess.lookup decides from a few columns so record pages can refuse
# a lesson before loading anything they show. It must agree with check, the
# rule the lesson page itself uses, in every case.
class LessonReadAccessTest < ActiveSupport::TestCase
  def setup
    travel_to Time.utc(2030, 7, 10, 2)
    @curriculum = Curriculum.create!(name: "Access curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @later_module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 2", position: 1, day_offset: 7, schedule_days: "weekdays")
    @open = Lesson.create!(curriculum_module: @module, title: "Open", position: 0, release_day: 0)
    @future = Lesson.create!(curriculum_module: @module, title: "Future", position: 1, release_day: 60)
    @unassigned = Lesson.create!(curriculum_module: @later_module, title: "Unassigned", position: 0, release_day: 0)
    @archived = Lesson.create!(curriculum_module: @module, title: "Archived", position: 2, release_day: 0, archived_at: 1.day.ago)
    @away = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: Curriculum.create!(name: "Away"), name: "Away", position: 0), title: "Away", position: 0, release_day: 0)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Program", start_date: Date.new(2030, 7, 1), status: :active)
    @student = User.create!(clerk_id: "access_student", email: "access-student@example.com", first_name: "Access", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active, joined_at: 1.day.ago)
    @assignment = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @module, unlocked: true)
  end

  def teardown
    travel_back
  end

  test "lookup agrees with check across assignments, releases, schedules, pauses and cohorts" do
    lessons = [ @open, @future, @unassigned, @archived, @away ]
    scenarios = access_scenarios

    outcomes = Set.new
    scenarios.each do |label, arrange|
      ActiveRecord::Base.transaction do
        arrange.call
        [ nil, @cohort.id ].each do |cohort_id|
          lessons.each do |lesson|
            expected = LessonReadAccess.check(@student.reload, lesson.reload, cohort_id: cohort_id)
            actual = LessonReadAccess.lookup(@student, lesson.id, cohort_id: cohort_id)
            context = "#{label}, #{lesson.title}, cohort_id=#{cohort_id.inspect}"
            assert_equal [ expected.allowed?, expected.error, expected.enrollment&.id ], [ actual.allowed?, actual.error, actual.enrollment&.id ], context
            outcomes << expected.error
          end
        end
        raise ActiveRecord::Rollback
      end
    end
    assert_equal Set[nil, LessonReadAccess::NOT_UNLOCKED, LessonReadAccess::NOT_ACCESSIBLE], outcomes, "The matrix reaches every outcome"
  end

  test "check_many agrees with check for every lesson in the batch" do
    lessons = [ @open, @future, @unassigned, @archived, @away ]
    access_scenarios.each do |label, arrange|
      ActiveRecord::Base.transaction do
        arrange.call
        [ nil, @cohort.id ].each do |cohort_id|
          student = @student.reload
          batch = LessonReadAccess.check_many(student, lessons.map(&:reload), cohort_id: cohort_id)
          lessons.each do |lesson|
            expected = LessonReadAccess.check(student, lesson, cohort_id: cohort_id)
            actual = batch.fetch(lesson.id)
            assert_equal [ expected.allowed?, expected.error, expected.enrollment&.id ], [ actual.allowed?, actual.error, actual.enrollment&.id ],
              "#{label}, #{lesson.title}, cohort_id=#{cohort_id.inspect}"
          end
        end
        raise ActiveRecord::Rollback
      end
    end

    staff = User.create!(clerk_id: "batch_staff", email: "batch-staff@example.com", first_name: "Staff", role: :instructor)
    assert LessonReadAccess.check_many(staff, lessons).values.all?(&:allowed?)
  end

  test "check_many loads the learner's enrollment once per curriculum" do
    lessons = 4.times.map { |i| Lesson.create!(curriculum_module: @module, title: "Batch #{i}", position: 10 + i, release_day: 0) }
    count = ->(batch) {
      queries = []
      callback = ->(*, payload) { queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:cached] }
      ActiveRecord::Base.uncached do
        ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { LessonReadAccess.check_many(@student.reload, batch) }
      end
      queries.size
    }

    fresh = ->(records) { Lesson.where(id: records.map(&:id)).to_a }
    assert_equal count.call(fresh.call(lessons.first(1))), count.call(fresh.call(lessons))
    assert LessonReadAccess.check_many(@student, lessons).values.all?(&:allowed?)
  end

  test "lookup answers nil for a missing lesson and is for learners only" do
    assert_nil LessonReadAccess.lookup(@student, 999_999)
    staff = User.create!(clerk_id: "access_staff", email: "access-staff@example.com", first_name: "Staff", role: :instructor)
    assert_raises(ArgumentError) { LessonReadAccess.lookup(staff, @open.id) }
  end

  test "lookup reads only the columns the rule needs and returns read-only records" do
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless payload[:name] == "SCHEMA" }
    @student.reload
    access = ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { LessonReadAccess.lookup(@student, @open.id) }

    assert access.allowed?
    assert_equal 2, queries.size, queries.join("\n")
    assert_empty queries.grep(/title|"name"|\.name\b|description|\.\*/), queries.join("\n")
    assert access.enrollment.readonly?
    assert_raises(ActiveModel::MissingAttributeError) { access.enrollment.cohort.name }
  end

  private

  def access_scenarios
    {
      "assigned module" => -> { },
      "module locked until a future date" => -> { @assignment.update!(unlocked: false, unlock_date_override: Date.new(2030, 8, 1)) },
      "module override reached" => -> { @assignment.update!(unlocked: false, unlock_date_override: Date.new(2030, 7, 5)) },
      "cohort module schedule" => -> { @cohort.cohort_module_schedules.create!(curriculum_module: @module, start_date: Date.new(2030, 4, 29)) },
      "lesson unlocked on its own" => -> { LessonAssignment.create!(enrollment: @enrollment, lesson: @unassigned, unlocked: true) },
      "lesson assigned but locked" => -> { LessonAssignment.create!(enrollment: @enrollment, lesson: @unassigned, unlocked: false) },
      "lesson override in the future" => -> { LessonAssignment.create!(enrollment: @enrollment, lesson: @future, unlock_date_override: Date.new(2030, 9, 1)) },
      "self-paced cohort" => -> { @cohort.update!(course_delivery: "self_paced") },
      "paused before the release" => -> { @enrollment.update!(status: :paused) },
      "completed enrollment" => -> { @enrollment.update!(status: :completed) },
      "expired access" => -> { @enrollment.update_columns(access_expires_at: 1.day.ago) },
      "no enrollment" => -> { @enrollment.destroy! }
    }
  end
end

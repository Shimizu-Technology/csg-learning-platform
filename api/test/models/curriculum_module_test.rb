require_relative "../support/model_coverage"

class CurriculumModuleTest < ModelCoverageTestCase
  test "calendar helpers use schedule weekdays offsets and release weeks" do
    mod.update!(schedule_days: "tth")
    assert_equal [ "Tuesday", "Thursday" ], mod.scheduled_day_names
    assert_equal 1, mod.first_scheduled_day_index
    assert_equal 10, mod.release_day_for(week: 2, weekday_index: 3)
    assert_equal({ week: 2, weekday_index: 3, day_name: "Thursday" }, mod.week_and_day_for(10))
    assert_equal 9, mod.calendar_offset_for(10)
    assert_equal Date.new(2026, 4, 7), mod.next_start_date_on_or_after(Date.new(2026, 4, 6))
    assert_equal Date.new(2026, 4, 7), mod.next_start_date_on_or_after(Date.new(2026, 4, 7))
    assert mod.valid_release_day?(10)
    assert_not mod.valid_release_day?(nil)
    assert_not mod.valid_release_day?(0)
    assert_invalid mod, :schedule_days, "unknown"
    assert_invalid mod, :position, -1
  end

  test "archived lessons remain protected during schedule edits and are destroyed with module" do
    lesson.update!(archived_at: Time.current)
    assert_empty mod.lessons
    assert_includes mod.all_lessons, lesson
    assert_not mod.update(schedule_days: "tth")
    assert mod.errors[:schedule_days].any?
    mod.reload.destroy!
    assert_not Lesson.exists?(lesson.id)
  end

  test "new modules assign unlocked access to active alumni only" do
    course.update!(cohort_type: :alumni)
    enrollment
    created = CurriculumModule.create!(curriculum: curriculum, name: "Alumni module", position: 1)
    assert enrollment.module_assignments.find_by!(curriculum_module: created).unlocked?
    enrollment.update!(status: :paused)
    excluded = CurriculumModule.create!(curriculum: curriculum, name: "Later", position: 2)
    assert_not enrollment.module_assignments.exists?(curriculum_module: excluded)
  end
end

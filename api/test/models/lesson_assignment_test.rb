require_relative "../support/model_coverage"

class LessonAssignmentTest < ModelCoverageTestCase
  test "unlock date uses Guam today and records only newly available changes" do
    assignment = LessonAssignment.create!(enrollment: enrollment, lesson: lesson, unlocked: false)
    original = assignment.availability_changed_at
    assert_not assignment.available?(course)
    travel 1.hour
    assignment.update!(unlock_date_override: Date.new(2026, 4, 6))
    assert assignment.available?(course)
    assert_equal Time.current, assignment.availability_changed_at
    changed = assignment.availability_changed_at
    travel 1.hour
    assignment.update!(unlocked: true)
    assert_equal changed, assignment.availability_changed_at
    assert_operator changed, :>, original
    assert_invalid assignment.dup, :lesson_id, lesson.id
    second_lesson = Lesson.create!(curriculum_module: mod, title: "Second", position: 1, release_day: 1)
    other = LessonAssignment.create!(enrollment: enrollment, lesson: second_lesson)
    assert_database_rejects other, { lesson_id: lesson.id }, ActiveRecord::RecordNotUnique
  end
end

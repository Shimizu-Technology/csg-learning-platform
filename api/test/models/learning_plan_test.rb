require_relative "../support/model_coverage"

class LearningPlanTest < ModelCoverageTestCase
  test "required overrides apply only to active plans and snapshot excludes database identity" do
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    lesson
    enrollment.cohort.curriculum.reload
    row = LearningPlan.create!(enrollment: enrollment, title: "Plan", lesson_overrides: [ { "lesson_id" => lesson.id, "required" => false, "reason" => "Already demonstrated" } ])
    assert_not row.required?(lesson)
    assert_equal "Plan", row.snapshot["title"]
    assert_not row.snapshot.key?("id")
    row.update!(active: false)
    assert_equal lesson.required?, row.required?(lesson)
    assert_not row.dup.valid?
  end

  test "scope date and duplicate milestone validation preserve assigned learning boundaries" do
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    lesson
    enrollment.cohort.curriculum.reload
    row = LearningPlan.create!(enrollment: enrollment, title: "Plan")
    assert_invalid row, :target_date, "2026-02-30"
    assert_invalid row, :lesson_overrides, [ { "lesson_id" => -1, "required" => true, "reason" => "Missing" } ]
    milestone = { "title" => "First", "due_on" => "2026-04-07", "lesson_ids" => [ lesson.id ] }
    assert_invalid row, :milestones, [ milestone, milestone ]
    row.update!(milestones: [ milestone ], target_date: Date.new(2026, 4, 8))
    assert_invalid row, :target_date, Date.new(2026, 4, 6)
  end
end

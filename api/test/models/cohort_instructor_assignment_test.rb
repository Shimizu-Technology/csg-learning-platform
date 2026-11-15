require_relative "../support/model_coverage"

class CohortInstructorAssignmentTest < ModelCoverageTestCase
  test "only instructors can be assigned and duplicates are rejected by model and database" do
    assert_invalid CohortInstructorAssignment.new(cohort: course), :user, student
    assert_invalid CohortInstructorAssignment.new(cohort: course), :user, staff
    instructor = person(:instructor)
    assignment = course.cohort_instructor_assignments.create!(user: instructor)
    assert_invalid assignment.dup, :user_id, instructor.id
    other = course.cohort_instructor_assignments.create!(user: person(:instructor))
    assert_database_rejects other, { user_id: instructor.id }, ActiveRecord::RecordNotUnique
  end

  test "create and destroy reset cable while rollback does not" do
    instructor = person(:instructor)
    calls = []
    original = CableConnectionReset.method(:call)
    CableConnectionReset.define_singleton_method(:call) { |user| calls << user.id }
    assignment = course.cohort_instructor_assignments.create!(user: instructor)
    assignment.destroy!
    assert_equal [ instructor.id, instructor.id ], calls
    calls.clear
    CohortInstructorAssignment.transaction(requires_new: true) do
      course.cohort_instructor_assignments.create!(user: instructor)
      raise ActiveRecord::Rollback
    end
    assert_empty calls
  ensure
    CableConnectionReset.define_singleton_method(:call, original)
  end
end

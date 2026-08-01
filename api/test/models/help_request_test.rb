require "test_helper"

class HelpRequestTest < ActiveSupport::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Help curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Help cohort", start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "help_model_student", email: "help-model-student@example.com", role: :student)
    @staff = User.create!(clerk_id: "help_model_staff", email: "help-model-staff@example.com", role: :instructor)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "acknowledging and resolving preserve an auditable visible state" do
    request = create_request

    request.acknowledge!(@staff)
    assert request.status_acknowledged?
    assert_equal @staff, request.owner
    assert request.acknowledged_at

    request.resolve!(@staff, response: "Review the route nesting, then try once more.")
    assert request.status_resolved?
    assert request.resolved_at
    assert_equal "Review the route nesting, then try once more.", request.staff_response
  end

  test "owner must be staff and student must belong to the cohort" do
    other_student = User.create!(clerk_id: "help_model_other", email: "help-model-other@example.com", role: :student)
    request = create_request(owner: @student)

    refute request.valid?
    assert_includes request.errors[:owner], "must be staff"

    request = create_request(student: other_student)
    refute request.valid?
    assert_includes request.errors[:cohort], "must include the student"
  end

  test "resolved requests remain terminal and preserve their resolution time" do
    request = create_request
    request.resolve!(@staff, response: "Start with the smallest reproducible route.")
    resolved_at = request.resolved_at

    request.acknowledge!(@staff)
    request.resolve!(@staff, response: "A later response")

    assert request.status_resolved?
    assert_equal resolved_at, request.resolved_at
    assert_equal "Start with the smallest reproducible route.", request.staff_response
  end

  test "terminal and owned states require their audit fields" do
    request = create_request
    request.status = :resolved

    refute request.valid?
    assert_includes request.errors[:owner], "can't be blank"
    assert_includes request.errors[:staff_response], "can't be blank"
    assert_includes request.errors[:resolved_at], "can't be blank"
  end

  test "stale cancellation cannot overwrite a concurrent resolution" do
    stale_request = create_request
    current_request = HelpRequest.find(stale_request.id)
    current_request.resolve!(@staff, response: "Try the smallest route first.")

    changed = stale_request.cancel!

    refute changed
    assert stale_request.reload.status_resolved?
    assert_nil stale_request.canceled_at
    assert_equal "Try the smallest route first.", stale_request.staff_response
  end

  test "stale staff transitions cannot overwrite a concurrent cancellation" do
    stale_request = create_request
    current_request = HelpRequest.find(stale_request.id)
    assert current_request.cancel!

    refute stale_request.acknowledge!(@staff)
    refute stale_request.resolve!(@staff, response: "This must not be sent.")
    assert stale_request.reload.status_canceled?
    assert_nil stale_request.owner
    assert_nil stale_request.staff_response
  end

  private

  def create_request(student: @student, owner: nil)
    HelpRequest.new(
      student: student,
      cohort: @cohort,
      owner: owner,
      context_type: :lesson,
      context_source: :primary,
      context_id: 1,
      context_label: "Routing",
      context_path: "/lessons/1",
      category: :concept,
      urgency: :normal,
      message: "I understand the pieces but not how they connect."
    ).tap { |request| request.save! if owner.nil? && student == @student }
  end
end

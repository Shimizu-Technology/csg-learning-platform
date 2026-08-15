require "test_helper"

class InterventionWorkflowsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  def setup
    @curriculum = Curriculum.create!(name: "Intervention curriculum")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Routing", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Nested resource", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Intervention cohort", start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "intervention_student", email: "intervention-student@example.com", first_name: "Maya", last_name: "Santos", role: :student)
    @staff = User.create!(clerk_id: "intervention_staff", email: "intervention-staff@example.com", first_name: "Inez", last_name: "Instructor", role: :instructor)
    @other_staff = User.create!(clerk_id: "intervention_owner", email: "intervention-owner@example.com", first_name: "Owen", last_name: "Owner", role: :admin)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
  end

  test "staff creates an owned intervention from server-generated privacy-safe evidence" do
    submission = Submission.create!(user: @student, content_block: @block, text: "private student code", grade: :R, feedback: "private staff feedback")

    as_user(@staff) do
      post "/api/v1/interventions", params: {
        intervention: {
          enrollment_id: @enrollment.id,
          trigger_type: "redo",
          severity: "urgent",
          status: "canceled",
          owner_id: @other_staff.id,
          action_summary: "Review the redo together.",
          next_follow_up_at: 2.days.from_now,
          evidence_snapshot: { message: "must be ignored", body: "must be ignored" }
        }
      }, headers: auth_headers, as: :json
    end

    assert_response :created
    intervention = Intervention.find(JSON.parse(response.body).dig("intervention", "id"))
    assert_equal @other_staff, intervention.owner
    assert intervention.status_open?
    assert_equal [ submission.id ], intervention.evidence_snapshot.fetch("submission_ids")
    assert_equal 1, intervention.evidence_snapshot.fetch("count")
    refute_includes intervention.evidence_snapshot.to_json, "private student code"
    refute_includes intervention.evidence_snapshot.to_json, "private staff feedback"
    refute intervention.evidence_snapshot.key?("message")
    assert_enqueued_with(job: PushNotificationJob)
  end

  test "staff records private notes and closes an intervention with an outcome" do
    intervention = create_intervention

    as_user(@staff) do
      post "/api/v1/interventions/#{intervention.id}/notes", params: { note: { body: "Called the student and agreed on a smaller next step." } }, headers: auth_headers, as: :json
    end
    assert_response :created

    as_user(@student) { get "/api/v1/interventions/#{intervention.id}", headers: auth_headers }
    assert_response :forbidden

    as_user(@staff) do
      patch "/api/v1/interventions/#{intervention.id}", params: {
        intervention: { status: "resolved", outcome: "re_engaged", resolution_summary: "Student returned and completed the next checkpoint." }
      }, headers: auth_headers, as: :json
    end
    assert_response :success
    payload = JSON.parse(response.body).fetch("intervention")
    assert_equal "resolved", payload.fetch("status")
    assert_equal "re_engaged", payload.fetch("outcome")
    assert_equal "Called the student and agreed on a smaller next step.", payload.fetch("notes").sole.fetch("body")
    assert intervention.reload.resolved_at

    as_user(@staff) do
      patch "/api/v1/interventions/#{intervention.id}", params: { intervention: { status: "open" } }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "staff creates and checks in on a recovery plan" do
    intervention = create_intervention(trigger_type: :extended_absence)

    as_user(@staff) do
      post "/api/v1/recovery_plans", params: {
        recovery_plan: {
          enrollment_id: @enrollment.id,
          intervention_id: intervention.id,
          source: "extended_absence",
          target_pace: "Two required lessons each week",
          required_scope: "Complete the required Week 1 checkpoints.",
          optional_scope: "Recordings are optional.",
          next_check_in_at: 3.days.from_now
        }
      }, headers: auth_headers, as: :json
    end
    assert_response :created
    plan = RecoveryPlan.find(JSON.parse(response.body).dig("recovery_plan", "id"))

    as_user(@staff) do
      post "/api/v1/recovery_plans/#{plan.id}/check_ins", params: {
        check_in: { body: "The first lesson is complete; keep the same pace.", next_check_in_at: 1.week.from_now }
      }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal 1, plan.check_ins.count
    assert plan.reload.last_check_in_at

    as_user(@student) { get "/api/v1/recovery_plans/#{plan.id}", headers: auth_headers }
    assert_response :forbidden
  end

  test "support queue exposes intervention and recovery ownership without private notes" do
    intervention = create_intervention
    intervention.notes.create!(author: @staff, body: "Private staff-only context")
    RecoveryPlan.create!(
      enrollment: @enrollment,
      intervention: intervention,
      owner: @staff,
      created_by: @staff,
      source: :extended_absence,
      target_pace: "One lesson per day",
      required_scope: "Required checkpoints",
      check_in_cadence: "weekly",
      next_check_in_at: 1.day.ago
    )

    as_user(@staff) { get "/api/v1/support_queue", headers: auth_headers }
    assert_response :success
    queue = JSON.parse(response.body).fetch("support_queue")
    assert_equal 1, queue.dig("summary", "active_intervention_count")
    assert_equal 1, queue.dig("summary", "due_follow_up_count")
    assert_equal 1, queue.dig("summary", "due_recovery_check_in_count")
    refute_includes queue.to_json, "Private staff-only context"
    student = queue.fetch("students").find { |item| item.fetch("enrollment_id") == @enrollment.id }
    assert_equal intervention.id, student.fetch("active_intervention_id")
    assert student.fetch("follow_up_due")
  end

  private

  def create_intervention(trigger_type: :inactivity)
    Intervention.create!(
      enrollment: @enrollment,
      trigger_type: trigger_type,
      severity: :normal,
      status: :open,
      evidence_snapshot: InterventionEvidenceBuilder.new(enrollment: @enrollment, trigger_type: trigger_type).call,
      owner: @staff,
      created_by: @staff,
      action_summary: "Check in with the student.",
      next_follow_up_at: 1.day.ago
    )
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

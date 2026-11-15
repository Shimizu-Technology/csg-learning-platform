require_relative "../support/model_coverage"

class InterventionTest < ModelCoverageTestCase
  test "resolution requires outcome stamps time and reopening clears resolution" do
    assert intervention.active?
    assert_includes Intervention.due, intervention
    assert_not intervention.update(status: :resolved)
    intervention.reload.update!(status: :resolved, outcome: :re_engaged)
    assert_equal Time.current, intervention.resolved_at
    assert_not Intervention.active.exists?(intervention.id)
    intervention.update!(status: :monitoring)
    assert_nil intervention.resolved_at
    assert_nil intervention.outcome
    intervention.update!(follow_up_notified_at: Time.current)
    intervention.update!(next_follow_up_at: 1.day.from_now)
    assert_nil intervention.follow_up_notified_at
    assert_not Intervention.due.exists?(intervention.id)
    assert_invalid intervention, :evidence_snapshot, []
    assert_invalid intervention, :owner, student
  end

  test "one active trigger per enrollment and destroy removes notes and nullifies plan" do
    intervention
    other = Intervention.create!(enrollment: enrollment, owner: staff, created_by: staff, trigger_type: :manual, status: :canceled)
    assert_database_rejects other, { status: :open }, ActiveRecord::RecordNotUnique, constraint: "index_interventions_one_active_trigger"
    note = intervention.notes.create!(author: staff, body: "Contacted")
    plan.update!(intervention: intervention)
    intervention.destroy!
    assert_not InterventionNote.exists?(note.id)
    assert_nil plan.reload.intervention_id
  end
end

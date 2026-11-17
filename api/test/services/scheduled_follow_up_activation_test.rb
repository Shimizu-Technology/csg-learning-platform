require "test_helper"

class ScheduledFollowUpActivationTest < ActiveSupport::TestCase
  test "preview counts old valid follow-ups and approval marks only dates strictly before cutoff without sending" do
    now = Time.utc(2026, 11, 18, 21)
    curriculum = Curriculum.create!(name: "Activation")
    cohort = Cohort.create!(curriculum: curriculum, name: "Activation", start_date: Date.current)
    owner = User.create!(clerk_id: "activation_owner", email: "activation-owner@example.test", role: :admin)
    student = User.create!(clerk_id: "activation_student", email: "activation-student@example.test")
    enrollment = Enrollment.create!(cohort: cohort, user: student)
    rows = [ now - 8.days, now - 7.days, now - 1.day, now + 1.day ].each_with_index.map do |date, index|
      Intervention.create!(enrollment: enrollment, owner: owner, created_by: owner, next_follow_up_at: date, trigger_type: %i[manual inactivity redo ungraded][index], evidence_snapshot: {})
    end
    preview = InterventionFollowUpJob.preview(now)
    assert_equal 3, preview[:follow_ups_due]
    assert_equal 1, preview[:older_than_7_days]
    assert_equal 1, ScheduledFollowUpActivation.call(activation_at: now, older_than_days: 7)[:candidates]
    assert rows.all? { |item| item.reload.follow_up_notified_at.nil? }
    assert_raises(ArgumentError) { ScheduledFollowUpActivation.call(activation_at: now, older_than_days: 7, confirmation: "yes") }
    assert_no_difference("Notification.count") do
      result = ScheduledFollowUpActivation.call(activation_at: now, older_than_days: 7, confirmation: ScheduledFollowUpActivation::CONFIRMATION)
      assert_equal 1, result[:marked]
    end
    assert_equal now, rows.first.reload.follow_up_notified_at
    assert rows.drop(1).all? { |item| item.reload.follow_up_notified_at.nil? }
  end
end

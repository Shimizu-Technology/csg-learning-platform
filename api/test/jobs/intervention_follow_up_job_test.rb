require "test_helper"

class InterventionFollowUpJobTest < ActiveJob::TestCase
  include ActiveJob::TestHelper

  test "notifies an owner once for the current due date" do
    curriculum = Curriculum.create!(name: "Follow-up curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Follow-up cohort", start_date: Date.current, status: :active)
    student = User.create!(clerk_id: "follow_up_student", email: "follow-up-student@example.com", role: :student)
    owner = User.create!(clerk_id: "follow_up_owner", email: "follow-up-owner@example.com", role: :instructor)
    enrollment = Enrollment.create!(user: student, cohort: cohort)
    intervention = Intervention.create!(
      enrollment: enrollment,
      trigger_type: :inactivity,
      severity: :normal,
      status: :contacted,
      evidence_snapshot: {},
      owner: owner,
      created_by: owner,
      next_follow_up_at: 1.hour.ago
    )

    assert_enqueued_with(job: PushNotificationJob) { InterventionFollowUpJob.perform_now }
    notification = Notification.find_by!(notifiable: intervention, user: owner)
    assert_equal "intervention", notification.notification_type
    assert_equal "Follow-up due for #{student.full_name}", notification.title
    assert_equal "Inactivity", notification.body
    assert intervention.reload.follow_up_notified_at

    assert_no_enqueued_jobs(only: PushNotificationJob) { InterventionFollowUpJob.perform_now }
  end
end

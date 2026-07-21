require "test_helper"

class SubmissionNotificationDeliveryServiceTest < ActiveJob::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Notification curriculum")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = Lesson.create!(curriculum_module: mod, title: "Deploy safely", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Production checklist")
    @student = User.create!(clerk_id: "submission_notify_student", email: "submission-notify-student@example.com", role: :student)
    @instructor = User.create!(clerk_id: "submission_notify_instructor", email: "submission-notify-instructor@example.com", role: :instructor)
    @admin = User.create!(clerk_id: "submission_notify_admin", email: "submission-notify-admin@example.com", role: :admin)
    @archived_staff = User.create!(clerk_id: "submission_notify_archived", email: "submission-notify-archived@example.com", role: :instructor, archived_at: Time.current)
    @submission = Submission.create!(user: @student, content_block: block, text: "Ready")
  end

  test "a new submission alerts active staff and queues push delivery" do
    expected_args = ->(args) { args[0] == "Submission" && args[1] == @submission.id && args[2].length == 2 }
    assert_enqueued_with(job: PushNotificationJob, args: expected_args) do
      NotificationDeliveryService.submission_created(@submission)
    end

    recipients = Notification.where(notifiable: @submission).order(:user_id).pluck(:user_id)
    assert_equal [ @instructor.id, @admin.id ].sort, recipients.sort
    assert_not_includes recipients, @archived_staff.id
    assert Notification.where(notifiable: @submission).all?(&:submission?)
  end

  test "grading alerts the student and refreshes an existing unread notification" do
    @submission.update!(grade: "R", feedback: "Add rollback steps", grader: @instructor, graded_at: Time.current)

    assert_enqueued_with(job: PushNotificationJob) do
      NotificationDeliveryService.submission_graded(@submission)
    end

    notification = @student.notifications.find_by!(notifiable: @submission)
    assert_equal "Redo requested", notification.title
    assert_equal "Add rollback steps", notification.body
    assert_equal "/lessons/#{@submission.content_block.lesson_id}", notification.path

    notification.mark_read!
    @submission.update!(grade: "A", feedback: "Ready to ship")
    NotificationDeliveryService.submission_graded(@submission, push: false)
    assert_nil notification.reload.read_at
    assert_equal "Submission graded A", notification.title
  end
end

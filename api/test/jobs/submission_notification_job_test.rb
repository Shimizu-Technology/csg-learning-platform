require "test_helper"

class SubmissionNotificationJobTest < ActiveJob::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Submission job curriculum")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = Lesson.create!(curriculum_module: mod, title: "Ship safely", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Release checklist")
    @student = User.create!(clerk_id: "submission_job_student", email: "submission-job-student@example.com", role: :student)
    @instructor = User.create!(clerk_id: "submission_job_instructor", email: "submission-job-instructor@example.com", role: :instructor)
    @admin = User.create!(clerk_id: "submission_job_admin", email: "submission-job-admin@example.com", role: :admin)
    @submission = Submission.create!(user: @student, content_block: block, text: "Ready")
  end

  test "created event fans out staff notifications outside the request" do
    assert_enqueued_with(job: PushNotificationJob) do
      SubmissionNotificationJob.perform_now("created", @submission.id, @submission.created_at.iso8601(6))
    end

    assert_equal [ @instructor.id, @admin.id ].sort,
      Notification.where(notifiable: @submission).pluck(:user_id).sort
  end

  test "created event is obsolete after the submission has been graded" do
    @submission.update!(grade: "A", grader: @instructor, graded_at: Time.current)

    assert_no_enqueued_jobs only: PushNotificationJob do
      SubmissionNotificationJob.perform_now("created", @submission.id, @submission.created_at.iso8601(6))
    end
    assert_not Notification.exists?(notifiable: @submission)
  end

  test "graded event notifies the student and queues push" do
    @submission.update!(grade: "B", feedback: "Strong work", grader: @instructor, graded_at: Time.current)

    assert_enqueued_with(job: PushNotificationJob) do
      SubmissionNotificationJob.perform_now("graded", @submission.id, @submission.graded_at.iso8601(6))
    end

    notification = @student.notifications.find_by!(notifiable: @submission)
    assert_equal "Submission graded B", notification.title
    assert_equal "Strong work", notification.body
  end

  test "a duplicate graded event does not enqueue push or reset read state" do
    @submission.update!(grade: "B", feedback: "Strong work", grader: @instructor, graded_at: Time.current)
    event_at = @submission.graded_at.iso8601(6)
    SubmissionNotificationJob.perform_now("graded", @submission.id, event_at)
    notification = @student.notifications.find_by!(notifiable: @submission)
    notification.mark_read!
    push_jobs = enqueued_jobs.count { |job| job[:job] == PushNotificationJob }

    SubmissionNotificationJob.perform_now("graded", @submission.id, event_at)

    assert_equal push_jobs, enqueued_jobs.count { |job| job[:job] == PushNotificationJob }
    assert_not_nil notification.reload.read_at
  end

  test "a stale graded event does not overwrite a newer grade" do
    @submission.update!(grade: "B", feedback: "First review", grader: @instructor, graded_at: Time.current)
    stale_event = @submission.graded_at.iso8601(6)
    travel 1.second do
      @submission.update!(grade: "R", feedback: "New review", graded_at: Time.current)
    end

    assert_no_enqueued_jobs only: PushNotificationJob do
      SubmissionNotificationJob.perform_now("graded", @submission.id, stale_event)
    end
    assert_not Notification.exists?(notifiable: @submission, user: @student)
  end

  test "missing submissions are discarded" do
    submission_id = @submission.id
    @submission.destroy!

    assert_nothing_raised do
      SubmissionNotificationJob.perform_now("created", submission_id, Time.current.iso8601(6))
    end
  end

  test "unknown events raise" do
    assert_raises(ArgumentError) do
      SubmissionNotificationJob.perform_now("unknown", @submission.id, Time.current.iso8601(6))
    end
  end
end

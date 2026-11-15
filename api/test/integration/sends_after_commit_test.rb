require "test_helper"
require_relative "../support/after_commit_helpers"

# Production runs jobs inline, so a push or email requested inside a row lock
# used to make its HTTP call while the lock was held, and could still be rolled
# back afterwards. These tests run the inline adapter and stub each provider at
# the point where the job hands off to HTTP, recording whether any transaction
# (and so any row or advisory lock) was still open at that moment.
class SendsAfterCommitTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers

  setup do
    @curriculum = Curriculum.create!(name: "After commit course")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays", module_type: :live_class)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Routes", position: 0, release_day: 0, requires_submission: true)
    @block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 0, title: "Exercise 1", body: "Build it", submission_type: :text_submission)
    @student = User.create!(clerk_id: "after_commit_student", email: "after-commit-student@example.com", first_name: "Sam", last_name: "Learner", role: :student)
    @instructor = User.create!(clerk_id: "after_commit_instructor", email: "after-commit-instructor@example.com", first_name: "Ina", last_name: "Teacher", role: :instructor)
    @admin = User.create!(clerk_id: "after_commit_admin", email: "after-commit-admin@example.com", first_name: "Ada", last_name: "Admin", role: :admin)
    [ @student, @instructor, @admin ].each { |user| user.update!(community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION) }
    @cohort = Cohort.create!(curriculum: @curriculum, name: "After commit cohort", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
  end

  test "a new submission pushes staff only after the enrollment lock commits" do
    with_inline_jobs do
      with_push_calls(:submission_changed) do |calls|
        as_user(@student) { post "/api/v1/submissions", params: { content_block_id: @block.id, text: "first try" }, headers: auth_headers, as: :json }

        assert_response :created
        assert_sent_after_commit(calls, "submission push")
        assert_equal [ @admin.id, @instructor.id ].sort, pushed_user_ids(calls).uniq.sort
      end
    end
  end

  test "a submission rolled back after its notification was requested pushes nobody" do
    original = Api::V1::SubmissionsController.instance_method(:submission_json)

    with_inline_jobs do
      with_push_calls(:submission_changed) do |calls|
        # Rendering happens inside the enrollment lock, after the enqueue.
        Api::V1::SubmissionsController.define_method(:submission_json) { |*| raise "render failed" }
        assert_raises(RuntimeError) do
          as_user(@student) { post "/api/v1/submissions", params: { content_block_id: @block.id, text: "lost" }, headers: auth_headers, as: :json }
        end

        assert_empty calls
        assert_not Submission.exists?(user: @student, content_block: @block)
        assert_not Notification.exists?(notifiable_type: "Submission")
      end
    end
  ensure
    Api::V1::SubmissionsController.define_method(:submission_json, original)
  end

  test "grading and a redo request push and email the student after the grade commits" do
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "draft")

    with_inline_jobs do
      with_push_calls(:submission_changed) do |pushes|
        record_external_calls(NotificationEmailService, :send_redo_notification, returns: true) do |emails|
          as_user(@instructor) do
            patch "/api/v1/submissions/#{submission.id}/grade",
              params: { grade: "R", feedback: "Handle the empty case.", base_submission_updated_at: submission.updated_at.iso8601(6) },
              headers: auth_headers, as: :json
          end

          assert_response :success
          assert_sent_after_commit(pushes, "redo push")
          assert_sent_after_commit(emails, "redo email")
          assert_equal [ @student.id ], pushed_user_ids(pushes).uniq
        end
      end

      redone = submission.reload
      with_push_calls(:submission_changed) do |pushes|
        as_user(@instructor) do
          patch "/api/v1/submissions/#{redone.id}/grade",
            params: { grade: "A", feedback: "Great.", base_submission_updated_at: redone.updated_at.iso8601(6) },
            headers: auth_headers, as: :json
        end

        assert_response :success
        assert_sent_after_commit(pushes, "grade push")
      end
    end
  end

  test "a grade rejected inside the submission lock sends nothing" do
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "draft")

    with_inline_jobs do
      with_push_calls(:submission_changed) do |pushes|
        record_external_calls(NotificationEmailService, :send_redo_notification, returns: true) do |emails|
          as_user(@instructor) do
            patch "/api/v1/submissions/#{submission.id}/grade",
              params: { grade: "R", feedback: "Stale", base_submission_updated_at: 1.day.ago.iso8601(6) },
              headers: auth_headers, as: :json
          end

          assert_response :conflict
          assert_empty pushes
          assert_empty emails
        end
      end
    end
  end

  test "help requests push staff and then the student after each change commits" do
    with_inline_jobs do
      with_push_calls(:help_request_changed) do |calls|
        as_user(@student) do
          post "/api/v1/help_requests", params: {
            help_request: { cohort_id: @cohort.id, context_type: "exercise", context_source: "primary", context_id: @block.id, category: "technical", message: "Stuck on the route." }
          }, headers: auth_headers
        end

        assert_response :created
        assert_sent_after_commit(calls, "help request push")
        assert_equal [ @admin.id, @instructor.id ].sort, pushed_user_ids(calls).uniq.sort
      end

      help_request = HelpRequest.find_by!(student: @student)
      with_push_calls(:help_request_changed) do |calls|
        as_user(@instructor) { patch "/api/v1/help_requests/#{help_request.id}", params: { help_request: { status: "acknowledged" } }, headers: auth_headers }

        assert_response :success
        assert_sent_after_commit(calls, "acknowledgement push")
        assert_equal [ @student.id ], pushed_user_ids(calls).uniq
      end
    end
  end

  test "help request notifications rolled back with their transaction push nobody" do
    help_request = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: @lesson.id,
      context_label: @lesson.title, context_path: "/lessons/#{@lesson.id}", category: :concept, message: "Next step?")

    with_inline_jobs do
      with_push_calls(:help_request_changed) do |calls|
        HelpRequest.transaction do
          NotificationDeliveryService.help_request_created(help_request)
          raise ActiveRecord::Rollback
        end

        assert_empty calls
        assert_not Notification.exists?(notifiable: help_request)
      end
    end
  end

  test "a direct message pushes and emails after the delivery lock is released" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])

    with_inline_jobs do
      with_push_calls(:message_created) do |pushes|
        record_external_calls(NotificationEmailService, :send_message_notification, returns: true) do |emails|
          as_user(@instructor) do
            post "/api/v1/direct_conversations/#{conversation.id}/messages",
              params: { body: "Office hours at 5.", client_message_id: "after-commit-dm-1" }, headers: auth_headers, as: :json
          end

          assert_response :created
          assert_sent_after_commit(pushes, "DM push")
          assert_sent_after_commit(emails, "DM email")
          assert_equal [ @student.id ], pushed_user_ids(pushes).uniq
          assert_equal [ @student.id ], emails.map { |call| call[:kwargs].fetch(:user).id }
        end
      end
    end

    message = Message.find_by!(client_message_id: "after-commit-dm-1")
    assert message.notifications_delivered_at
    assert message.broadcasts_delivered_at
  end

  test "a saved direct message is reported sent even when its email fails after commit" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    failing_email = ->(**) { raise NotificationEmailService::DeliveryError, "provider down" }

    with_inline_jobs do
      with_push_calls(:message_created) do
        record_external_calls(NotificationEmailService, :send_message_notification, returns: failing_email) do |emails|
          as_user(@instructor) do
            post "/api/v1/direct_conversations/#{conversation.id}/messages",
              params: { body: "Saved despite email.", client_message_id: "after-commit-dm-2" }, headers: auth_headers, as: :json
          end

          assert_response :created
          assert_equal 1, emails.size
        end
      end
    end

    message = Message.find_by!(client_message_id: "after-commit-dm-2")
    assert_equal "Saved despite email.", response.parsed_body.dig("message", "body")
    assert message.notifications_delivered_at
    assert message.broadcasts_delivered_at
  end

  test "a broadcast failure discards the deferred sends and the replay sends them exactly once" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    original_broadcast = UserMessagesChannel.method(:broadcast_to)
    fail_broadcast = true
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, payload|
      raise "cable unavailable" if fail_broadcast

      original_broadcast.call(user, payload)
    end
    params = { body: "Replay me.", client_message_id: "after-commit-dm-replay" }

    with_inline_jobs do
      with_push_calls(:message_created) do |pushes|
        record_external_calls(NotificationEmailService, :send_message_notification, returns: true) do |emails|
          as_user(@instructor) { post "/api/v1/direct_conversations/#{conversation.id}/messages", params: params, headers: auth_headers, as: :json }

          assert_response :service_unavailable
          assert_empty pushes, "the rolled-back delivery lock must drop its push job"
          assert_empty emails, "the rolled-back delivery lock must drop its email job"
          message = Message.find_by!(client_message_id: "after-commit-dm-replay")
          assert_nil message.notifications_delivered_at, "notifications were never sent, so they must not be marked delivered"
          assert_nil message.notifications_delivery_claim, "the rollback releases the claim so a replay can redo the stage now"

          fail_broadcast = false
          2.times do
            as_user(@instructor) { post "/api/v1/direct_conversations/#{conversation.id}/messages", params: params, headers: auth_headers, as: :json }
            assert_response :success
          end

          assert_sent_after_commit(pushes, "replayed DM push")
          assert_equal 1, pushes.count { |call| call[:target] == WebPushNotificationService }
          assert_equal 1, pushes.count { |call| call[:target] == ExpoPushNotificationService }
          assert_equal [ @student.id ], emails.map { |call| call[:kwargs].fetch(:user).id }
          assert message.reload.notifications_delivered_at
          assert message.broadcasts_delivered_at
          assert_not_includes Message.delivery_recovery_due, message
        end
      end
    end
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if original_broadcast
  end

  test "a crash after the delivery checkpoints leaves the notifications recoverable and recovery sends once" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    message = conversation.messages.create!(author: @instructor, body: "Crash before commit", delivery_tracking_requested: true)

    with_inline_jobs do
      with_push_calls(:message_created) do |pushes|
        record_external_calls(NotificationEmailService, :send_message_notification, returns: true) do |emails|
          # The process dies after every delivery write but before the delivery
          # lock commits: no commit or rollback callback ever runs, so neither
          # the deferred jobs nor anything registered after them happen.
          record_external_calls(ActiveRecord, :after_all_transactions_commit) do
            MessageDeliveryService.created(message)
          end

          assert_empty pushes
          assert_empty emails
          message.reload
          assert message.broadcasts_delivered_at, "the broadcast checkpoints were already durable"
          assert_nil message.notifications_delivered_at, "unsent notifications must not be acknowledged"
          assert message.notifications_delivery_claim
          assert_not_includes Message.delivery_recovery_due, message, "the dead claim's lease is still running"

          travel MessageDeliveryService::DELIVERY_LEASE + 1.minute do
            assert_includes Message.delivery_recovery_due, message
            MessageDeliveryRecoveryJob.perform_now
            MessageDeliveryRecoveryJob.perform_now
          end

          assert_sent_after_commit(pushes, "recovered DM push")
          assert_equal 1, pushes.count { |call| call[:target] == WebPushNotificationService }
          assert_equal 1, pushes.count { |call| call[:target] == ExpoPushNotificationService }
          assert_equal [ @student.id ], emails.map { |call| call[:kwargs].fetch(:user).id }
          assert message.reload.notifications_delivered_at
          assert_nil message.notifications_delivery_claim
        end
      end
    end
  end

  test "redoing the notification stage after its jobs ran does not push again" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    message = conversation.messages.create!(author: @instructor, body: "Completion lost", delivery_tracking_requested: true)
    original_complete = MessageDeliveryService.method(:safely_complete_notifications)

    with_inline_jobs do
      with_push_calls(:message_created) do |pushes|
        # The jobs ran, then the completion write was lost.
        MessageDeliveryService.define_singleton_method(:safely_complete_notifications) { |*| nil }
        MessageDeliveryService.created(message)
        restore_private_singleton(MessageDeliveryService, :safely_complete_notifications, original_complete)
        assert_equal 2, pushes.size
        assert_nil message.reload.notifications_delivered_at

        travel MessageDeliveryService::DELIVERY_LEASE + 1.minute do
          MessageDeliveryRecoveryJob.perform_now
        end

        assert_equal 2, pushes.size, "each push provider was already claimed for these notifications"
        assert message.reload.notifications_delivered_at
      end
    end
  ensure
    restore_private_singleton(MessageDeliveryService, :safely_complete_notifications, original_complete) if original_complete
  end

  test "message notifications rolled back with their transaction push and email nobody" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    message = conversation.messages.create!(author: @instructor, body: "Rolled back")

    with_inline_jobs do
      with_push_calls(:message_created) do |pushes|
        record_external_calls(NotificationEmailService, :send_message_notification, returns: true) do |emails|
          Message.transaction do
            NotificationDeliveryService.message_created(message, push: true)
            raise ActiveRecord::Rollback
          end

          assert_empty pushes
          assert_empty emails
        end
      end
    end
  end

  test "an announcement pushes after it is saved and a rolled-back one pushes nobody" do
    with_inline_jobs do
      with_push_calls(:announcement_published) do |calls|
        as_user(@admin) do
          post "/api/v1/announcements", params: { title: "Lab closed Friday", body: "Work from home.", audience: "global", status: "published", send_push: true }, headers: auth_headers, as: :json
        end

        assert_response :created
        assert_sent_after_commit(calls, "announcement push")
      end

      with_push_calls(:announcement_published) do |calls|
        Announcement.transaction do
          announcement = Announcement.create!(title: "Draft", body: "Never sent", author: @admin, audience: :global, status: :published)
          NotificationDeliveryService.announcement_published(announcement, push: true)
          raise ActiveRecord::Rollback
        end

        assert_empty calls
      end
    end
  end

  test "an enrollment invite emails after the enrollment and invite status commit" do
    invitee = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "after-commit-invitee@example.com", role: :student)

    with_inline_jobs do
      record_external_calls(UserInviteEmailService, :send_invite, returns: true) do |emails|
        as_user(@admin) do
          post "/api/v1/cohorts/#{@cohort.id}/enrollments", params: { user_id: invitee.id, send_invite: true }, headers: auth_headers, as: :json
        end

        assert_response :created
        assert_sent_after_commit(emails, "invite email")
        assert_equal "sent", invitee.reload.invite_delivery_status
      end

      other = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "after-commit-rollback@example.com", role: :student)
      record_external_calls(UserInviteEmailService, :send_invite, returns: true) do |emails|
        User.transaction do
          UserInvitationDispatchService.new(user: other, invited_by: @admin).call
          raise ActiveRecord::Rollback
        end

        assert_empty emails
        assert_equal "not_sent", other.reload.invite_delivery_status
      end
    end
  end

  test "an intervention follow-up pushes its owner after the intervention lock commits" do
    intervention = Intervention.create!(enrollment: @enrollment, trigger_type: :inactivity, severity: :normal, status: :contacted,
      evidence_snapshot: {}, owner: @instructor, created_by: @instructor, next_follow_up_at: 1.hour.ago)

    with_inline_jobs do
      with_push_calls(:intervention_changed) do |calls|
        InterventionFollowUpJob.perform_now

        assert_sent_after_commit(calls, "follow-up push")
        assert_equal [ @instructor.id ], pushed_user_ids(calls).uniq
        assert intervention.reload.follow_up_notified_at
      end
    end
  end

  private

  # Stubs both push providers' entry points for one notifiable kind.
  def with_push_calls(method_name)
    calls = []
    record_external_calls(WebPushNotificationService, method_name, calls: calls) do
      record_external_calls(ExpoPushNotificationService, method_name, calls: calls) { yield calls }
    end
  end

  def restore_private_singleton(target, method_name, original)
    target.define_singleton_method(method_name, original)
    target.singleton_class.send(:private, method_name)
  end

  def pushed_user_ids(calls)
    calls.flat_map { |call| Array(call[:args].last).map(&:user_id) }
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

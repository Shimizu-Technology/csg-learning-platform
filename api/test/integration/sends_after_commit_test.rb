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

  # Message notifications are the exception to after-commit sends. The #216
  # delivery flow marks its notification stage delivered after requesting the
  # push and email jobs, and production has no job runner to recover a send
  # deferred past that mark (AS-6). So, exactly as on main, the sends are
  # attempted inside the delivery lock, before the stage is marked delivered,
  # and no row lock on the message is held while they run.
  test "a direct message is pushed and emailed before its notification stage is marked delivered" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])

    with_inline_jobs do
      with_message_sends do |sends|
        post_dm(conversation, "Office hours at 5.", "dm-ordering")

        assert_response :created
        assert_equal %i[web_push expo_push dm_email], sends.map { |send| send[:kind] }
        sends.each do |send|
          assert_nil send[:notifications_delivered_at], "#{send[:kind]} must be attempted before the stage is marked delivered"
          assert_equal [ MessageDeliveryLockRecord.connection_pool ], send[:open_pools], "#{send[:kind]} runs inside the delivery lock only, with no row lock"
        end
        assert_equal [ @student.id ], sends.map { |send| send[:user_id] }.uniq
      end
    end

    message = Message.find_by!(client_message_id: "dm-ordering")
    assert message.notifications_delivered_at
    assert message.broadcasts_delivered_at
  end

  # A process exit at each point of the delivery flow, followed by the
  # client's immediate replay. The expected sends are main's: everything main
  # had attempted by that point has been attempted here too. Before this fix
  # was narrowed, the last two points had attempted nothing, and the replay
  # still reported success.
  INTERRUPTIONS = {
    during_web_push: { web_push: 1, expo_push: 0, dm_email: 0, notifications_delivered: false },
    during_expo_push: { web_push: 1, expo_push: 1, dm_email: 0, notifications_delivered: false },
    during_dm_email: { web_push: 1, expo_push: 1, dm_email: 1, notifications_delivered: false },
    marking_notifications_delivered: { web_push: 1, expo_push: 1, dm_email: 1, notifications_delivered: false },
    during_broadcast: { web_push: 1, expo_push: 1, dm_email: 1, notifications_delivered: true },
    committing_delivery_lock: { web_push: 1, expo_push: 1, dm_email: 1, notifications_delivered: true }
  }.freeze

  INTERRUPTIONS.each do |point, expected|
    test "a process exit #{point.to_s.humanize(capitalize: false)} has attempted what main attempted, and the replay sends nothing twice" do
      conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
      client_message_id = "dm-exit-#{point}"

      with_inline_jobs do
        with_message_sends(exit_at: point) do |sends|
          with_process_exit_at(point) do
            assert_raises(SimulatedProcessExit) { post_dm(conversation, "Exit #{point}", client_message_id) }
          end

          attempted = sends.map { |send| send[:kind] }.tally
          %i[web_push expo_push dm_email].each do |kind|
            assert_equal expected.fetch(kind), attempted.fetch(kind, 0), "#{kind} attempts when the process exits #{point}"
          end
          message = Message.find_by!(client_message_id: client_message_id)
          assert_equal expected.fetch(:notifications_delivered), message.notifications_delivered_at.present?

          # The client never got a response, so it replays at once. The dead
          # process's lease is still live (or the stage is done), so the replay
          # succeeds without sending anything again: the same as main.
          post_dm(conversation, "Exit #{point}", client_message_id)
          assert_response :success
          assert_equal attempted, sends.map { |send| send[:kind] }.tally
        end
      end
    end
  end

  test "a saved direct message is reported sent when its email fails, after the email was attempted" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    reported = []
    subscriber = Object.new
    subscriber.define_singleton_method(:report) { |error, **context| reported << [ error, context[:source] ] }
    Rails.error.subscribe(subscriber)
    logs = StringIO.new
    original_logger = Rails.logger
    Rails.logger = ActiveSupport::BroadcastLogger.new(original_logger, ActiveSupport::Logger.new(logs))

    with_inline_jobs do
      with_message_sends(failing_email_user_ids: [ @student.id ]) do |sends|
        post_dm(conversation, "Saved despite email.", "dm-email-fails")

        assert_response :created
        email = sends.find { |send| send[:kind] == :dm_email }
        assert email, "the email was attempted"
        assert_nil email[:notifications_delivered_at], "inside the delivery flow, before the stage is marked delivered"
      end
    end

    message = Message.find_by!(client_message_id: "dm-email-fails")
    assert_equal "Saved despite email.", response.parsed_body.dig("message", "body")
    assert message.notifications_delivered_at
    assert message.broadcasts_delivered_at
    assert_includes reported.map { |error, source| [ error.class, source ] }, [ NotificationEmailService::DeliveryError, "message_notification_email_job" ]
    assert_includes logs.string, "[MessageEmailJob] retry_unavailable message_id=#{message.id}"
  ensure
    Rails.error.unsubscribe(subscriber) if subscriber
    Rails.logger = original_logger if original_logger
  end

  test "one group DM recipient's failed email does not skip the others" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student, @admin ])

    with_inline_jobs do
      with_message_sends(failing_email_user_ids: [ [ @student.id, @admin.id ].min ]) do |sends|
        post_dm(conversation, "Group update.", "group-dm-email-fails")

        assert_response :created
        assert_equal [ @admin.id, @student.id ].sort, sends.select { |send| send[:kind] == :dm_email }.map { |send| send[:user_id] }.sort
      end
    end
  end

  test "a broadcast failure after the sends returns retryable and the replay does not send again" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    original_broadcast = UserMessagesChannel.method(:broadcast_to)
    fail_broadcast = true
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, payload|
      raise "cable unavailable" if fail_broadcast

      original_broadcast.call(user, payload)
    end

    with_inline_jobs do
      with_message_sends do |sends|
        post_dm(conversation, "Replay me.", "dm-broadcast-fails")

        assert_response :service_unavailable
        assert_equal({ web_push: 1, expo_push: 1, dm_email: 1 }, sends.map { |send| send[:kind] }.tally)
        message = Message.find_by!(client_message_id: "dm-broadcast-fails")
        assert message.notifications_delivered_at, "the sends were attempted before the broadcast, as on main"
        assert_nil message.broadcasts_delivered_at

        fail_broadcast = false
        2.times do
          post_dm(conversation, "Replay me.", "dm-broadcast-fails")
          assert_response :success
        end

        assert_equal({ web_push: 1, expo_push: 1, dm_email: 1 }, sends.map { |send| send[:kind] }.tally)
        assert message.reload.broadcasts_delivered_at
        assert_not_includes Message.delivery_recovery_due, message
      end
    end
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if original_broadcast
  end

  test "pushes a deadline left unstarted keep the stage open and the replay sends them" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    not_started = true
    deadline = lambda do |_message, notifications|
      raise PushDeliveryNotStarted.new(provider: "web_push", notification_ids: notifications.map(&:id)) if not_started
    end

    with_inline_jobs do
      with_message_sends(web_push: deadline) do |sends|
        post_dm(conversation, "Slow provider.", "dm-push-not-started")

        assert_response :service_unavailable
        message = Message.find_by!(client_message_id: "dm-push-not-started")
        assert_equal({ web_push: 1, expo_push: 1, dm_email: 1 }, sends.map { |send| send[:kind] }.tally, "Expo and email still went out")
        assert_nil message.notifications_delivered_at
        assert_nil message.notifications_delivery_claim, "the stage is released for the replay"
        assert_empty message.web_push_attempted_notification_ids, "the unstarted web push is released"
        assert_equal 1, message.expo_push_attempted_notification_ids.size

        not_started = false
        post_dm(conversation, "Slow provider.", "dm-push-not-started")

        assert_response :success
        # The email is requested again with the same Resend idempotency key
        # (one per notification), so Resend does not send it twice.
        assert_equal({ web_push: 2, expo_push: 1, dm_email: 2 }, sends.map { |send| send[:kind] }.tally)
        assert message.reload.notifications_delivered_at
        assert_equal 1, message.web_push_attempted_notification_ids.size
      end
    end
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

  # follow_up_notified_at commits with the follow-up and stops later runs, so
  # the push is requested inside the same transaction, as on main: Solid
  # Queue (this recurring job's only runner) commits the push job with the
  # mark, and inline it is attempted before the mark.
  test "an intervention follow-up is pushed before it is marked notified" do
    intervention = Intervention.create!(enrollment: @enrollment, trigger_type: :inactivity, severity: :normal, status: :contacted,
      evidence_snapshot: {}, owner: @instructor, created_by: @instructor, next_follow_up_at: 1.hour.ago)
    notified_at_send = []
    record_notified = ->(*) { notified_at_send << Intervention.where(id: intervention.id).pick(:follow_up_notified_at) }

    with_inline_jobs do
      record_external_calls(WebPushNotificationService, :intervention_changed, returns: record_notified) do |calls|
        InterventionFollowUpJob.perform_now

        assert_equal [ @instructor.id ], pushed_user_ids(calls).uniq
        assert_equal [ nil ], notified_at_send, "the push is attempted before the follow-up is marked notified"
        assert intervention.reload.follow_up_notified_at
      end
    end
  end

  private

  class SimulatedProcessExit < Exception; end # rubocop:disable Lint/InheritException

  def post_dm(conversation, body, client_message_id)
    as_user(@instructor) do
      post "/api/v1/direct_conversations/#{conversation.id}/messages",
        params: { body: body, client_message_id: client_message_id }, headers: auth_headers, as: :json
    end
  end

  # Stubs the three message providers at the point each hands off to HTTP and
  # records, per call, the stage state and the pools with an open transaction.
  def with_message_sends(exit_at: nil, failing_email_user_ids: [], web_push: nil)
    sends = []
    snapshot = lambda do |kind, message, user_ids|
      user_ids.each do |user_id|
        sends << {
          kind: kind,
          user_id: user_id,
          notifications_delivered_at: Message.where(id: message.id).pick(:notifications_delivered_at),
          open_pools: ActiveRecord.all_open_transactions.map { |transaction| transaction.connection.pool }.uniq
        }
      end
    end
    push = lambda do |kind|
      lambda do |message, notifications|
        snapshot.call(kind, message, notifications.map(&:user_id))
        raise SimulatedProcessExit if exit_at == :"during_#{kind}"

        web_push.call(message, notifications) if kind == :web_push && web_push
        true
      end
    end
    email = lambda do |user:, message:, notification:|
      snapshot.call(:dm_email, message, [ user.id ])
      raise SimulatedProcessExit if exit_at == :during_dm_email
      raise NotificationEmailService::DeliveryError, "provider down" if failing_email_user_ids.include?(user.id)

      true
    end

    record_external_calls(WebPushNotificationService, :message_created, returns: push.call(:web_push)) do
      record_external_calls(ExpoPushNotificationService, :message_created, returns: push.call(:expo_push)) do
        record_external_calls(NotificationEmailService, :send_message_notification, returns: email) { yield sends }
      end
    end
  end

  # Raises an Exception no `rescue StandardError` catches, like a process exit:
  # nothing after that point runs, and the open delivery-lock transaction ends
  # without committing, as it would when the connection drops.
  def with_process_exit_at(point)
    case point
    when :marking_notifications_delivered
      exit_when_marking = lambda do |original, message, completed_attribute, *rest|
        raise SimulatedProcessExit if completed_attribute == :notifications_delivered_at

        original.call(message, completed_attribute, *rest)
      end
      wrap_private_singleton(MessageDeliveryService, :complete_delivery, exit_when_marking) { yield }
    when :during_broadcast
      original = UserMessagesChannel.method(:broadcast_to)
      UserMessagesChannel.define_singleton_method(:broadcast_to) { |*| raise SimulatedProcessExit }
      begin
        yield
      ensure
        UserMessagesChannel.define_singleton_method(:broadcast_to, original)
      end
    when :committing_delivery_lock
      exit_before_commit = lambda do |original, message|
        original.call(message)
        raise SimulatedProcessExit
      end
      wrap_private_singleton(MessageDeliveryService, :deliver_created, exit_before_commit) { yield }
    else
      yield
    end
  end

  def wrap_private_singleton(target, method_name, wrapper)
    original = target.method(method_name)
    target.define_singleton_method(method_name) { |*args| wrapper.call(original, *args) }
    target.singleton_class.send(:private, method_name)
    yield
  ensure
    target.define_singleton_method(method_name, original)
    target.singleton_class.send(:private, method_name)
  end

  # Stubs both push providers' entry points for one notifiable kind.
  def with_push_calls(method_name)
    calls = []
    record_external_calls(WebPushNotificationService, method_name, calls: calls) do
      record_external_calls(ExpoPushNotificationService, method_name, calls: calls) { yield calls }
    end
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

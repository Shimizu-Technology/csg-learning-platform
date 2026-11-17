require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

# PR #282 fix round 1: two copies of one reply attempt (same client request id)
# arriving together, as a mobile retry can, save one reply and notify the
# learner once. Each request runs on its own connection; both queue behind a
# lock this test holds on the help request, then race for it.
class HelpRequestReplyRacesTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Reply races #{slug}")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Reply races #{slug}", start_date: Date.current, status: :active)
    @instructor = User.create!(clerk_id: "reply_races_staff_#{slug}", email: "reply-races-staff-#{slug}@example.invalid", first_name: "Ina", last_name: "Synthetic", role: :instructor)
    @student = User.create!(clerk_id: "reply_races_student_#{slug}", email: "reply-races-student-#{slug}@example.invalid", first_name: "Sam", last_name: "Synthetic", role: :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: 1,
      context_label: "Loops", context_path: "/lessons/1", category: :concept, message: "Synthetic question")
    @users = [ @instructor, @student ]
    @threads = []
    @notified = Queue.new
    @original_changed = NotificationDeliveryService.method(:help_request_changed)
    notified = @notified
    original = @original_changed
    NotificationDeliveryService.define_singleton_method(:help_request_changed) do |*args, **kwargs|
      notified << args.first.id
      original.call(*args, **kwargs.merge(push: false))
    end
    @original_verify = ClerkAuth.method(:verify)
    payload = { "sub" => @instructor.clerk_id, "email" => @instructor.email, "first_name" => "Ina", "last_name" => "Synthetic" }
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
  end

  teardown do
    finish_test_threads(@threads)
    NotificationDeliveryService.define_singleton_method(:help_request_changed, @original_changed) if @original_changed
    ClerkAuth.define_singleton_method(:verify, @original_verify) if @original_verify
    HelpRequestReply.where(help_request_id: @help&.id).delete_all
    Notification.where(user_id: @users.map(&:id)).delete_all
    HelpRequest.where(id: @help&.id).delete_all
    Enrollment.where(user_id: @users.map(&:id)).delete_all
    CohortInstructorAssignment.where(user_id: @users.map(&:id)).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@users)
  end

  [ false, true ].each do |resolve|
    test "two copies of one #{resolve ? 'Reply & resolve' : 'Reply'} attempt at once save one reply and notify once" do
      params = { reply: { body: "Add one to the counter.", resolve: resolve, client_request_id: "race-#{SecureRandom.hex(8)}" } }
      results = nil
      HelpRequest.transaction do
        @help.lock!
        holder = HelpRequest.connection.select_value("SELECT pg_backend_pid()")
        @threads = 2.times.map { Thread.new { send_reply(params) } }
        wait_for_lock_waiters(holder, workers: @threads)
      end
      results = @threads.map { |thread| thread.join(30) && thread.value }

      assert_equal [ 201, 201 ], results.map(&:first)
      assert_equal 1, results.map { |_, body| body.dig("reply", "id") }.uniq.size, "both requests return the one saved reply"
      assert_equal [ false, true ], results.map { |_, body| body["replayed"] }.sort_by { |value| value ? 1 : 0 }
      assert_equal 1, HelpRequestReply.where(help_request_id: @help.id).count
      assert_equal 1, @notified.size, "the learner is notified once"
      assert_equal(resolve ? "resolved" : "acknowledged", @help.reload.status)
    end
  end

  private

  def send_reply(params)
    ActiveRecord::Base.connection_pool.with_connection do
      session = ActionDispatch::Integration::Session.new(Rails.application)
      session.post "/api/v1/help_requests/#{@help.id}/replies", params: params, headers: { "Authorization" => "Bearer test_token" }, as: :json
      [ session.response.status, session.response.parsed_body ]
    end
  end
end

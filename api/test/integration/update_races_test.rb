require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require "timeout"

# PR #279 fix round 1: posting, editing and creating updates while another
# connection changes the same row. Each test runs a second request or write on
# its own database connection at a fixed point in the first request, then
# checks what was posted and who was told.
class UpdateRacesTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup

  # Runs `callback` (once) after the controller's early checks pass.
  module AfterEarlyCheck
    mattr_accessor :callback

    def authorize_announcement_management!
      result = super
      unless performed?
        callback = AfterEarlyCheck.callback
        AfterEarlyCheck.callback = nil
        callback&.call
      end
      result
    end
  end
  Api::V1::AnnouncementsController.prepend(AfterEarlyCheck) unless Api::V1::AnnouncementsController.ancestors.include?(AfterEarlyCheck)

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Update races #{slug}")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Taught #{slug}", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Not taught #{slug}", start_date: Date.current, status: :active)
    @admin = person("admin", :admin, slug)
    @author = person("author", :instructor, slug)
    @cohort.cohort_instructor_assignments.create!(user: @author)
    @student = person("student", :student, slug)
    @other_student = person("other", :student, slug)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @other_student, cohort: @other_cohort, status: :active)
    @users = [ @admin, @author, @student, @other_student ]
    @threads = []
    @original_verify = ClerkAuth.method(:verify)
    payloads = @users.to_h { |user| [ user.clerk_id, { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name } ] }
    ClerkAuth.define_singleton_method(:verify) { |token| payloads.fetch(token) }
  end

  teardown do
    AfterEarlyCheck.callback = nil
    finish_test_threads(@threads)
    ClerkAuth.define_singleton_method(:verify, @original_verify) if @original_verify
    announcement_ids = Announcement.where(author_id: @users.map(&:id)).pluck(:id)
    Notification.where(notifiable_type: "Announcement", notifiable_id: announcement_ids).delete_all
    Notification.where(user_id: @users.map(&:id)).delete_all
    Announcement.where(id: announcement_ids).delete_all
    Enrollment.where(user_id: @users.map(&:id)).delete_all
    CohortInstructorAssignment.where(user_id: @users.map(&:id)).delete_all
    [ @cohort, @other_cohort ].compact.each { |cohort| Cohort.find_by(id: cohort.id)&.destroy! }
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@users)
  end

  test "an admin moving a draft to a cohort the poster doesn't teach, after the early check, refuses the post" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    AfterEarlyCheck.callback = lambda do
      on_second_connection { Announcement.find(draft.id).update!(cohort_id: @other_cohort.id) }
    end

    patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: auth(@author), as: :json

    assert_nil AfterEarlyCheck.callback, "the move committed after the early check"
    assert_response :forbidden
    draft.reload
    assert draft.draft?, "the update was not posted"
    assert_equal @other_cohort.id, draft.cohort_id
    assert_equal 0, Notification.where(notifiable: draft).count, "nobody in the other cohort was told"
  end

  { "posting" => [ :draft, :patch, { status: "published", send_push: true } ],
    "editing" => [ :published, :patch, { title: "Changed" } ],
    "archiving" => [ :published, :delete, {} ],
    "deleting a draft" => [ :draft, :delete, {} ] }.each do |action, (status, verb, params)|
    test "removing an instructor assignment after the early check refuses #{action}" do
      announcement = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: status)
      AfterEarlyCheck.callback = -> { on_second_connection { CohortInstructorAssignment.where(user: @author, cohort: @cohort).delete_all } }

      assert_no_enqueued_jobs(only: PushNotificationJob) do
        public_send(verb, "/api/v1/announcements/#{announcement.id}", params: params, headers: auth(@author), as: :json)
      end

      assert_nil AfterEarlyCheck.callback
      assert_response :forbidden
      assert_equal status.to_s, announcement.reload.status
      assert_equal "Lab notes", announcement.title
      assert_equal 0, Notification.where(notifiable: announcement).count
    end
  end

  test "revoking the cached staff role after the early check refuses posting" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    AfterEarlyCheck.callback = -> { on_second_connection { User.find(@author.id).update!(role: :student) } }

    patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: auth(@author), as: :json

    assert_response :forbidden
    assert draft.reload.draft?
    assert_equal 0, Notification.where(notifiable: draft).count
  end

  test "an edit that lands while a draft is being posted reaches every notification" do
    draft = Announcement.create!(title: "Old title", body: "Old body", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    edit = nil
    during_fan_out do
      edit = in_thread { request(:patch, draft, { title: "New title", body: "New body" }, @admin) }
      wait_until_blocked_or_done(edit)
    end

    patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: auth(@author), as: :json
    assert_response :success
    assert_equal 200, Timeout.timeout(30) { edit.value }.first

    draft.reload
    assert_equal "New title", draft.title
    notifications = Notification.where(notifiable: draft)
    assert_equal draft.recipients.pluck(:id).sort, notifications.pluck(:user_id).sort
    assert_equal [ [ "New title", "New body" ] ], notifications.distinct.pluck(:title, :body)
  end

  test "two posts of one draft at the same moment notify each recipient once" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    second = nil
    fan_outs = during_fan_out do
      second = in_thread { request(:patch, draft, { status: "published" }, @author) }
      wait_until_blocked_or_done(second)
    end

    patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: auth(@author), as: :json
    assert_response :success
    assert_equal 200, Timeout.timeout(30) { second.value }.first
    assert_equal 1, fan_outs.size, "posted once"
    assert_equal [ @student.id ], Notification.where(notifiable: draft).pluck(:user_id)
  end

  test "two creates with one client request id at the same moment post one update" do
    params = { title: "Lab notes", body: "Bring laptops", audience: "cohort", cohort_id: @cohort.id, status: "published", client_request_id: "composer-#{SecureRandom.hex(8)}" }
    second = nil
    fan_outs = during_fan_out do
      second = in_thread { request(:post, nil, params, @author) }
      wait_until_blocked_or_done(second)
    end

    post "/api/v1/announcements", params: params, headers: auth(@author), as: :json
    assert_response :created
    first_id = response.parsed_body.dig("announcement", "id")
    status, body = Timeout.timeout(30) { second.value }

    assert_equal 201, status
    assert_equal first_id, body.dig("announcement", "id"), "the second request returns the first one's update"
    assert_equal 1, Announcement.where(author: @author, title: "Lab notes").count
    assert_equal 1, fan_outs.size
    assert_equal [ @student.id ], Notification.where(notifiable_id: first_id, notifiable_type: "Announcement").pluck(:user_id)
  end

  test "the race helper ignores another backend's ungranted lock" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    release = Queue.new
    target = nil
    Announcement.transaction do
      draft.lock!
      unrelated = in_thread { Announcement.find(draft.id).with_lock { true } }
      wait_until_blocked_or_done(unrelated)
      target = in_thread do |connection|
        Announcement.transaction do
          connection.select_value("SELECT 1") # materializes BEGIN, pinning the backend
          release.pop
        end
      end
      checks = 0
      observer = lambda do |*, payload|
        next unless payload[:sql].include?("FROM pg_locks")

        checks += 1
        release << true if checks == 2
      end
      ActiveSupport::Notifications.subscribed(observer, "sql.active_record") { wait_until_blocked_or_done(target) }
      assert_not target.alive?, "an unrelated lock must not satisfy the wait for the target backend"
      assert_operator checks, :>=, 2
    ensure
      release << true
      target&.join(5)
    end
  end

  # Under transaction pooling the PID read before BEGIN may belong to a
  # backend PgBouncer then lends to another client, which can be waiting.
  test "the race helper doesn't trust a backend before the target's BEGIN" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    release = Queue.new
    target = releaser = nil
    Announcement.transaction do
      draft.lock!
      unrelated = in_thread { Announcement.find(draft.id).with_lock { true } }
      wait_until_blocked_or_done(unrelated)
      target = in_thread { release.pop }
      target[:backend_pid] = unrelated[:backend_pid] # the lent backend, now a waiter
      releaser = Thread.new { sleep 0.3; release << true }
      wait_until_blocked_or_done(target)
      assert_not target.alive?, "a waiter on the pre-BEGIN backend must not satisfy the wait"
    ensure
      release << true
      target&.join(5)
      releaser&.join(5)
    end
  end

  test "the race helper doesn't trust a backend after an earlier transaction ends" do
    draft = Announcement.create!(title: "Lab notes", body: "Bring laptops", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    release = Queue.new
    committed = Queue.new
    target = releaser = nil
    Announcement.transaction do
      draft.lock!
      unrelated = in_thread { Announcement.find(draft.id).with_lock { true } }
      wait_until_blocked_or_done(unrelated)
      target = in_thread do |connection|
        Announcement.transaction { connection.select_value("SELECT 1") } # like sign-in's own transaction
        committed << true
        release.pop
      end
      Timeout.timeout(30) { committed.pop }
      target[:backend_pid] = unrelated[:backend_pid] # the freed backend, now lent to a waiter
      releaser = Thread.new { sleep 0.3; release << true }
      wait_until_blocked_or_done(target)
      assert_not target.alive?, "a waiter on a backend freed by COMMIT must not satisfy the wait"
    ensure
      release << true
      target&.join(5)
      releaser&.join(5)
    end
  end

  private

  def person(name, role, slug)
    User.create!(clerk_id: "races_#{name}_#{slug}", email: "races-#{name}-#{slug}@example.invalid", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def auth(user) = { "Authorization" => "Bearer #{user.clerk_id}" }

  def in_thread(&block)
    backend = Queue.new
    thread = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        worker = Thread.current
        capture_backend = -> { worker[:backend_pid] = ActiveRecord::Base.uncached { connection.select_value("SELECT pg_backend_pid()").to_i } }
        capture_backend.call
        backend << true
        # PgBouncer can choose a different backend for each transaction.
        # BEGIN has completed here, before the request attempts its row lock
        # or INSERT, so this PID stays pinned for the actual competing write.
        # The PID is trusted only inside a transaction: an earlier one (such as
        # sign-in's) can end and free its backend for another client before the
        # competing write begins. Savepoints don't end the transaction.
        on_begin = lambda do |*, payload|
          next unless Thread.current == worker

          if payload[:sql].match?(/\ABEGIN\b/)
            capture_backend.call
            worker[:pinned] = true
          elsif payload[:sql].match?(/\A(COMMIT|ROLLBACK)\z/)
            worker[:pinned] = false
          end
        end
        ActiveSupport::Notifications.subscribed(on_begin, "sql.active_record") { block.call(connection) }
      end
    end
    @threads << thread
    Timeout.timeout(30) { backend.pop }
    thread
  end

  def on_second_connection(&block)
    Timeout.timeout(30) { in_thread(&block).value }
  end

  # A request on another connection, as another browser tab would send it.
  def request(verb, announcement, params, user)
    session = ActionDispatch::Integration::Session.new(Rails.application)
    path = announcement ? "/api/v1/announcements/#{announcement.id}" : "/api/v1/announcements"
    session.public_send(verb, path, params: params, headers: auth(user), as: :json)
    [ session.response.status, session.response.parsed_body ]
  end

  # Runs the block the first time the request fans out, then fans out as
  # usual. Returns the list of fan-outs, filled in as they happen.
  def during_fan_out(&block)
    fan_outs = []
    original = NotificationDeliveryService.method(:announcement_published)
    pending = block
    NotificationDeliveryService.define_singleton_method(:announcement_published) do |*args, **kwargs|
      fan_outs << args.first.id
      run, pending = pending, nil
      run&.call
      original.call(*args, **kwargs)
    end
    @restore_fan_out = -> { NotificationDeliveryService.define_singleton_method(:announcement_published, original) }
    fan_outs
  end

  def after_teardown
    @restore_fan_out&.call
    super
  end

  # The other request either finished (it didn't need the row) or is waiting
  # for a lock this request holds. The request's query cache is bypassed so
  # each check reads pg_locks afresh.
  def wait_until_blocked_or_done(thread)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 15
    loop do
      return unless thread.alive?
      # Until BEGIN pins its backend, the PID may be lent to another client.
      if thread[:pinned]
        backend_pid = Integer(thread.fetch(:backend_pid))
        waiting = ActiveRecord::Base.uncached { ActiveRecord::Base.connection.select_value("SELECT count(*) FROM pg_locks WHERE NOT granted AND pid = #{backend_pid}") }
        return if waiting.to_i.positive?
      end
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
        flunk "the other request neither finished nor waited for a lock:\n#{thread.backtrace&.first(40)&.join("\n")}"
      end

      sleep 0.02
    end
  end
end

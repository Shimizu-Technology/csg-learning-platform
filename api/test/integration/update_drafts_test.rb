require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/query_counter"

# W6 PR 6.4a (U-3.6): drafts, editing after posting, and posting exactly once.
class UpdateDraftsTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include QueryCounter

  setup do
    curriculum = Curriculum.create!(name: "Drafts curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Drafts cohort", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: curriculum, name: "Other cohort", start_date: Date.current, status: :active)
    @admin = person("admin", :admin)
    @author = person("author", :instructor)
    @colleague = person("colleague", :instructor)
    [ @author, @colleague ].each { |instructor| @cohort.cohort_instructor_assignments.create!(user: instructor) }
    @student = person("student", :student)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "a draft reaches nobody: no notification, push, list, detail, search or Today for students or other staff" do
    as_user(@author) do
      assert_no_enqueued_jobs(only: PushNotificationJob) do
        post "/api/v1/announcements", params: draft_params(title: "Quiet draftneedle"), headers: headers, as: :json
      end
    end
    assert_response :created
    draft = Announcement.find(response.parsed_body.dig("announcement", "id"))
    assert draft.draft?
    assert_nil draft.published_at
    assert_equal 0, Notification.where(notifiable: draft).count

    as_user(@student) do
      get "/api/v1/announcements", params: { cohort_id: @cohort.id }, headers: headers
      assert_not_includes ids, draft.id
      get "/api/v1/announcements", params: { cohort_id: @cohort.id, scope: "manage", status: "draft" }, headers: headers
      assert_not_includes ids, draft.id
      assert_hidden_like_missing(draft)
      get "/api/v1/search", params: { q: "draftneedle" }, headers: headers
      assert_nil response.parsed_body.fetch("groups", {}).find { |group| group["type"] == "announcement" }
      get "/api/v1/notifications", headers: headers
      assert_empty response.parsed_body["notifications"]
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers
      assert_response :success
      assert_not_includes response.parsed_body.dig("dashboard", "cohort", "announcements").map { |item| item["id"] }, draft.id
    end

    as_user(@colleague) do
      get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers
      assert_not_includes ids, draft.id
      get "/api/v1/announcements", params: { scope: "manage" }, headers: headers
      assert_not_includes ids, draft.id
      assert_hidden_like_missing(draft)
      patch "/api/v1/announcements/#{draft.id}", params: { title: "Hijacked" }, headers: headers, as: :json
      assert_response :not_found
      delete "/api/v1/announcements/#{draft.id}", headers: headers
      assert_response :not_found
    end
    assert_equal "Quiet draftneedle", draft.reload.title

    [ @author, @admin ].each do |viewer|
      as_user(viewer) do
        get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers
        assert_includes ids, draft.id
        get "/api/v1/announcements/#{draft.id}", headers: headers
        assert_response :success
        assert_equal true, response.parsed_body.dig("announcement", "can_edit")
      end
    end
  end

  test "a draft can be saved before its text is written, but posting needs the text" do
    as_user(@author) do
      post "/api/v1/announcements", params: draft_params(body: ""), headers: headers, as: :json
      assert_response :created
      id = response.parsed_body.dig("announcement", "id")
      patch "/api/v1/announcements/#{id}", params: { status: "published" }, headers: headers, as: :json
      assert_response :unprocessable_entity
      assert_includes response.parsed_body["errors"], "Body can't be blank"
      assert Announcement.find(id).draft?
      assert_equal 0, Notification.where(notifiable_id: id, notifiable_type: "Announcement").count
    end
  end

  test "the author edits a draft, moves its audience, then posts it once after the commit" do
    draft = Announcement.create!(draft_attributes(author: @author, created_at: 2.days.ago))
    as_user(@author) do
      patch "/api/v1/announcements/#{draft.id}", params: { title: "Lab moves", body: "Room 2", audience: "cohort", cohort_id: @cohort.id }, headers: headers, as: :json
      assert_response :success
      assert_nil response.parsed_body.dig("announcement", "edited_at"), "draft edits are not edits"

      original = NotificationDeliveryService.method(:announcement_published)
      record_external_calls(NotificationDeliveryService, :announcement_published, returns: ->(*args, **kwargs) { original.call(*args, **kwargs) }) do |calls|
        assert_enqueued_jobs(1, only: PushNotificationJob) do
          patch "/api/v1/announcements/#{draft.id}", params: { status: "published", send_push: true }, headers: headers, as: :json
        end
        assert_response :success
        assert calls.first[:open_transactions].positive?, "the in-app notifications are written in the posting transaction"
        assert_equal 1, calls.size

        # A double click or a retry finds it already posted.
        assert_no_enqueued_jobs(only: PushNotificationJob) do
          2.times do
            patch "/api/v1/announcements/#{draft.id}", params: { status: "published", send_push: true, title: "Lab moves", body: "Room 2" }, headers: headers, as: :json
            assert_response :success
          end
        end
        assert_equal 1, calls.size, "posting fans out exactly once"
      end
    end

    draft.reload
    assert draft.published?
    assert_in_delta Time.current, draft.published_at, 5.seconds, "posting stamps the time it was posted"
    assert_nil draft.edited_at
    recipients = draft.recipients.pluck(:id).sort
    assert_equal recipients, Notification.where(notifiable: draft).pluck(:user_id).sort
    assert_includes recipients, @student.id
  end

  test "posting to another cohort is checked against where the poster can post" do
    draft = Announcement.create!(draft_attributes(author: @author))
    as_user(@author) do
      patch "/api/v1/announcements/#{draft.id}", params: { audience: "cohort", cohort_id: @other_cohort.id, status: "published" }, headers: headers, as: :json
      assert_response :forbidden
      patch "/api/v1/announcements/#{draft.id}", params: { audience: "global", status: "published" }, headers: headers, as: :json
      assert_response :forbidden
    end
    assert draft.reload.draft?
    assert_equal 0, Notification.where(notifiable: draft).count
  end

  test "only the author or an admin edits an update, draft or posted" do
    draft = Announcement.create!(draft_attributes(author: @author))
    posted = Announcement.create!(draft_attributes(author: @author, status: :published))
    # Someone else's draft is not found at all; a posted update they can read is refused.
    { draft => :not_found, posted => :forbidden }.each do |announcement, refusal|
      as_user(@colleague) do
        patch "/api/v1/announcements/#{announcement.id}", params: { title: "Hijacked" }, headers: headers, as: :json
        assert_response refusal
        patch "/api/v1/announcements/#{announcement.id}", params: { status: "published" }, headers: headers, as: :json
        assert_response refusal
      end
      assert_not_equal "Hijacked", announcement.reload.title
      if announcement.published?
        as_user(@colleague) do
          get "/api/v1/announcements/#{announcement.id}", headers: headers
          assert_equal [ false, true ], response.parsed_body["announcement"].values_at("can_edit", "can_archive"), "cohort staff archive a posted update they can't edit"
        end
      end
      as_user(@admin) do
        patch "/api/v1/announcements/#{announcement.id}", params: { title: "Admin fix" }, headers: headers, as: :json
        assert_response :success
      end
      as_user(@author) do
        patch "/api/v1/announcements/#{announcement.id}", params: { title: "Author fix" }, headers: headers, as: :json
        assert_response :success
      end
    end
    as_user(@colleague) do
      delete "/api/v1/announcements/#{draft.id}", headers: headers
      assert_response :not_found
      get "/api/v1/announcements/#{posted.id}", headers: headers
      assert_equal false, response.parsed_body.dig("announcement", "can_edit")
      delete "/api/v1/announcements/#{posted.id}", headers: headers
      assert_response :success
      assert_equal [ "archived", false ], response.parsed_body["announcement"].values_at("status", "can_archive")
    end
    assert Announcement.exists?(draft.id)
    as_user(@author) do
      get "/api/v1/announcements/#{draft.id}", headers: headers
      assert_equal [ true, false ], response.parsed_body["announcement"].values_at("can_edit", "can_archive"), "a draft is deleted, not archived"
    end
    as_user(@student) do
      get "/api/v1/announcements", params: { cohort_id: @cohort.id }, headers: headers
      response.parsed_body["announcements"].each { |item| assert_equal [ false, false ], item.values_at("can_edit", "can_archive") }
    end
  end

  test "an author who left the cohort can no longer edit their update" do
    posted = Announcement.create!(draft_attributes(author: @author, status: :published))
    @cohort.cohort_instructor_assignments.find_by!(user: @author).destroy!
    as_user(@author) do
      patch "/api/v1/announcements/#{posted.id}", params: { title: "Late fix" }, headers: headers, as: :json
      assert_response :forbidden
    end
  end

  test "editing a posted update shows Edited, keeps notifications as they were, and notifies nobody again" do
    posted = Announcement.create!(draft_attributes(author: @author, status: :published))
    NotificationDeliveryService.announcement_published(posted)
    notification = @student.notifications.find_by!(notifiable: posted)
    notification.mark_read!
    read_at = notification.reload.read_at
    count = Notification.where(notifiable: posted).count

    as_user(@author) do
      patch "/api/v1/announcements/#{posted.id}", params: { pinned: true }, headers: headers, as: :json
      assert_nil response.parsed_body.dig("announcement", "edited_at"), "pinning is not an edit"

      assert_no_enqueued_jobs do
        patch "/api/v1/announcements/#{posted.id}", params: { title: "Lab moves to room 3", body: "Room 3, not 2.", send_push: true, status: "published" }, headers: headers, as: :json
      end
      assert_response :success
      body = response.parsed_body["announcement"]
      assert body["edited_at"].present?
      assert_equal({ "id" => @author.id, "full_name" => @author.full_name }, body["edited_by"])
    end

    assert_equal count, Notification.where(notifiable: posted).count
    notification.reload
    assert_equal "Lab moves to room 3", notification.title
    assert_equal "Room 3, not 2.", notification.body
    assert_equal read_at, notification.read_at, "an edit does not mark the update unread"

    as_user(@admin) do
      patch "/api/v1/announcements/#{posted.id}", params: { body: "Room 4." }, headers: headers, as: :json
      assert_equal @admin.id, response.parsed_body.dig("announcement", "edited_by", "id")
    end

    as_user(@student) do
      get "/api/v1/announcements/#{posted.id}", headers: headers
      assert_response :success
      assert response.parsed_body.dig("announcement", "edited_at").present?
      assert_equal false, response.parsed_body.dig("announcement", "can_edit")
    end
  end

  test "a posted update keeps its audience and stays posted" do
    posted = Announcement.create!(draft_attributes(author: @admin, status: :published))
    as_user(@admin) do
      patch "/api/v1/announcements/#{posted.id}", params: { audience: "global" }, headers: headers, as: :json
      assert_response :unprocessable_entity
      assert_includes response.parsed_body["errors"], "Audience #{Announcement::AUDIENCE_LOCKED_MESSAGE}"
      patch "/api/v1/announcements/#{posted.id}", params: { audience: "cohort", cohort_id: @other_cohort.id }, headers: headers, as: :json
      assert_response :unprocessable_entity
      patch "/api/v1/announcements/#{posted.id}", params: { status: "draft" }, headers: headers, as: :json
      assert_response :unprocessable_entity
      # Sending the unchanged audience back (as the editors do) is fine.
      patch "/api/v1/announcements/#{posted.id}", params: { title: "Same people", audience: "cohort", cohort_id: @cohort.id }, headers: headers, as: :json
      assert_response :success
    end
    assert_equal @cohort.id, posted.reload.cohort_id
  end

  test "deleting a draft removes it and deleting a posted update archives it" do
    draft = Announcement.create!(draft_attributes(author: @author))
    posted = Announcement.create!(draft_attributes(author: @author, status: :published))
    as_user(@author) do
      delete "/api/v1/announcements/#{draft.id}", headers: headers
      assert_response :success
      assert_equal "draft", response.parsed_body.dig("announcement", "status")
      delete "/api/v1/announcements/#{posted.id}", headers: headers
      assert_response :success
      assert_equal "archived", response.parsed_body.dig("announcement", "status")
    end
    assert_not Announcement.exists?(draft.id)
    assert posted.reload.archived?
  end

  test "a new update is posted or drafted, and scheduling is not accepted" do
    as_user(@admin) do
      post "/api/v1/announcements", params: draft_params(status: "archived"), headers: headers, as: :json
      assert_response :unprocessable_entity
      post "/api/v1/announcements", params: draft_params(status: "published", published_at: 2.days.from_now.iso8601), headers: headers, as: :json
      assert_response :created
      assert_in_delta Time.current, Time.zone.parse(response.parsed_body.dig("announcement", "published_at")), 5.seconds
    end
  end

  test "the feed sends the same number of queries for one update or five" do
    viewers = { @student => {}, @author => { scope: "manage" }, @admin => { scope: "manage" } }
    # Grow once per size and measure every viewer at that size, so no viewer
    # is first measured after the data has already reached its largest size.
    counts = [ 1, 5 ].map do |size|
      grow_to(size)
      viewers.to_h do |viewer, params|
        as_user(viewer) { get "/api/v1/announcements", params: params.merge(cohort_id: @cohort.id), headers: headers }
        assert_response :success
        count = count_queries { as_user(viewer) { get "/api/v1/announcements", params: params.merge(cohort_id: @cohort.id), headers: headers } }
        assert_response :success
        assert_operator ids.size, :>=, size
        [ viewer, count ]
      end
    end
    viewers.each_key do |viewer|
      assert_equal counts.first[viewer], counts.last[viewer], "#{viewer.role} feed sent #{counts.first[viewer]} then #{counts.last[viewer]} queries for 1 then 5 updates"
    end
  end

  test "a post whose notifications fail partway stays a draft, and a retry tells everyone" do
    second = person("second", :student)
    Enrollment.create!(user: second, cohort: @cohort, status: :active)
    draft = Announcement.create!(draft_attributes(author: @author))
    written = 0
    failing = lambda do |original, user, announcement|
      raise ActiveRecord::StatementInvalid, "connection lost" if (written += 1) == 2

      original.bind_call(self, user, announcement)
    end

    replacing_instance_method(NotificationDeliveryService, :notification_for, failing) do
      as_user(@author) do
        assert_raises(ActiveRecord::StatementInvalid) do
          patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: headers, as: :json
        end
      end
    end
    assert draft.reload.draft?, "nothing was posted"
    assert_equal 0, Notification.where(notifiable: draft).count

    as_user(@author) { patch "/api/v1/announcements/#{draft.id}", params: { status: "published" }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ @student.id, second.id ].sort, Notification.where(notifiable: draft).pluck(:user_id).sort
  end

  test "a push that fails after posting leaves the post and every in-app notification in place" do
    draft = Announcement.create!(draft_attributes(author: @author))
    with_inline_jobs do
      replacing_instance_method(PushNotificationJob, :perform, ->(*) { raise "push provider down" }) do
        as_user(@author) { patch "/api/v1/announcements/#{draft.id}", params: { status: "published", send_push: true }, headers: headers, as: :json }
      end
    end
    assert_response :success
    assert draft.reload.published?
    assert_equal [ @student.id ], Notification.where(notifiable: draft).pluck(:user_id)
  end

  test "a create retried with the same client request id posts and notifies once" do
    key = "composer-#{SecureRandom.hex(8)}"
    as_user(@author) do
      assert_enqueued_jobs(1, only: PushNotificationJob) do
        2.times do
          post "/api/v1/announcements", params: draft_params(status: "published", client_request_id: key, send_push: true), headers: headers, as: :json
          assert_response :created
        end
      end
    end
    posted = Announcement.where(author: @author, client_request_id: key)
    assert_equal 1, posted.count
    assert_equal [ @student.id ], Notification.where(notifiable: posted.first).pluck(:user_id)

    # The id is per author, and an unusable id is refused rather than ignored.
    as_user(@admin) do
      post "/api/v1/announcements", params: draft_params(client_request_id: key), headers: headers, as: :json
      assert_response :created
      assert_not_equal posted.first.id, response.parsed_body.dig("announcement", "id")
      post "/api/v1/announcements", params: draft_params(client_request_id: "short"), headers: headers, as: :json
      assert_response :unprocessable_entity
    end
  end

  private

  def grow_to(size)
    @grown ||= 0
    while @grown < size
      @grown += 1
      writer = person("writer#{@grown}", :instructor)
      editor = person("editor#{@grown}", :admin)
      @cohort.cohort_instructor_assignments.create!(user: writer)
      posted = Announcement.create!(title: "Posted #{@grown}", body: "Body", author: writer, audience: :cohort, cohort: @cohort, status: :published)
      posted.update!(body: "Edited body", edited_at: Time.current, edited_by: editor)
      NotificationDeliveryService.announcement_published(posted)
      Announcement.create!(title: "Draft #{@grown}", body: "Draft", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
      Announcement.create!(title: "Global #{@grown}", body: "School", author: editor, audience: :global, status: :published)
    end
  end

  def draft_attributes(author:, status: :draft, **attributes)
    { title: "Lab notes", body: "Bring laptops", author: author, audience: :cohort, cohort: @cohort, status: status }.merge(attributes)
  end

  def draft_params(**overrides)
    { title: "Lab notes", body: "Bring laptops", audience: "cohort", cohort_id: @cohort.id, status: "draft" }.merge(overrides)
  end

  def ids = response.parsed_body["announcements"].map { |item| item["id"] }

  # Swaps an instance method for the block. The replacement is called with
  # the original UnboundMethod first, then the original arguments.
  def replacing_instance_method(klass, name, replacement)
    original = klass.instance_method(name)
    was_private = klass.private_method_defined?(name)
    klass.define_method(name) { |*args, **kwargs| instance_exec(original, *args, **kwargs, &replacement) }
    yield
  ensure
    klass.define_method(name, original)
    klass.send(:private, name) if was_private
  end

  # Hidden drafts answer exactly as an id that doesn't exist.
  def assert_hidden_like_missing(draft)
    get "/api/v1/announcements/#{Announcement.maximum(:id) + 1000}", headers: headers
    assert_response :not_found
    missing = [ response.status, response.body ]
    get "/api/v1/announcements/#{draft.id}", headers: headers
    assert_equal missing, [ response.status, response.body ]
  end

  def person(name, role)
    User.create!(clerk_id: "drafts_#{name}", email: "drafts-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

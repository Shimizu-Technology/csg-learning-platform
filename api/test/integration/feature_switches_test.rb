require "test_helper"

class FeatureSwitchesTest < ActionDispatch::IntegrationTest
  setup do
    @admin = User.create!(clerk_id: "switch_admin", email: "switch-admin@example.com", role: :admin)
    @student = User.create!(clerk_id: "switch_student", email: "switch-student@example.com", role: :student)
    @cohort = Cohort.create!(name: "Switch course", curriculum: Curriculum.create!(name: "Switch curriculum"), start_date: Date.current, status: :active)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
  end

  test "lazy creation recovers when another writer already inserted the row" do
    SchoolSetting.current.update!(features: { recordings: false })
    original = SchoolSetting.method(:find_by)
    first_lookup = true
    SchoolSetting.define_singleton_method(:find_by) do |**args|
      if first_lookup
        first_lookup = false
        nil
      else
        original.call(**args)
      end
    end
    as_user(@admin) { get "/api/v1/feature_settings", headers: @headers }
    assert_response :success
    assert_equal false, response.parsed_body.dig("features", "recordings")
    assert_equal 1, SchoolSetting.count
  ensure
    SchoolSetting.define_singleton_method(:find_by, original)
  end

  test "removed keys are filtered on read and ignored on write" do
    @cohort.update!(settings: { features: { course_community: false, recordings: false } })
    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers
      assert_response :success
      assert_equal({ "recordings" => false }, response.parsed_body["overrides"])
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers, params: { features: { course_community: false, recordings: true } }, as: :json
      assert_response :success
      assert_equal({ "recordings" => true }, @cohort.reload.settings["features"])
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers, params: { features: { recordings: "bad" } }, as: :json
      assert_response :unprocessable_entity
    end
  end

  test "settings are cached per request and refreshed next request" do
    SchoolSetting.current
    queries = []
    subscriber = ->(_name, _start, _finish, _id, payload) { queries << payload[:sql] if payload[:sql].match?(/SELECT.*school_settings/) }
    ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
      as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers }
    end
    assert_response :success
    assert_equal 1, queries.size
    SchoolSetting.current.update!(features: { recordings: false })
    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers }
    assert_equal false, response.parsed_body.dig("features", "recordings")
    assert_nil SchoolSetting::RequestCache.school_setting
  end

  test "GET falls back to defaults when lazy creation fails" do
    SchoolSetting.delete_all
    original = SchoolSetting.method(:create_or_find_by!)
    [ ActiveRecord::ReadOnlyError, ActiveRecord::StatementInvalid ].each do |error|
      SchoolSetting.define_singleton_method(:create_or_find_by!) do |**_args|
        connection.execute("INSERT INTO school_settings (missing_column) VALUES (1)") if error == ActiveRecord::StatementInvalid
        raise error, "insert unavailable"
      end
      get "/api/v1/course_offerings"
      assert_response :success
      assert_equal "automatic", response.parsed_body["public_catalog_mode"]
      as_user(@admin) { get "/api/v1/feature_settings", headers: @headers }
      assert_response :success
      assert_equal FeatureSwitches::DEFAULTS, response.parsed_body["features"]
      assert_equal 0, SchoolSetting.count # Failed INSERT must not poison the surrounding transaction.
    end
  ensure
    SchoolSetting.define_singleton_method(:create_or_find_by!, original)
  end

  test "all switches default on and explicit cohort values override school with nil inheriting" do
    assert_equal FeatureSwitches::KEYS.index_with(true), FeatureSwitches.for(cohort: @cohort)
    SchoolSetting.current.update!(features: { recordings: false, office_hours: false })
    @cohort.update!(settings: { features: { recordings: true, office_hours: nil, help_requests: false } })
    resolved = FeatureSwitches.for(cohort: @cohort)
    assert resolved["recordings"]
    assert_not resolved["office_hours"]
    assert_not resolved["help_requests"]
    assert resolved["announcements"]
  end

  test "admin settings preserve unrelated cohort configuration and audit actor and values" do
    @cohort.update!(settings: { "class_resources" => [], "recordings" => [] })
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers, params: { features: { recordings: false, office_hours: nil } }, as: :json
    end
    assert_response :success
    assert_equal false, response.parsed_body.dig("features", "recordings")
    assert_equal [], @cohort.reload.settings["recordings"]
    assert_equal({ "recordings" => false }, @cohort.settings["features"])
    audit = FeatureSwitchChange.last
    assert_equal @admin, audit.actor
    assert_equal @cohort, audit.cohort
    assert_equal true, audit.before.dig("features", "recordings")
    assert_equal false, audit.after.dig("features", "recordings")
  end

  test "learners cannot change defaults and unknown switches are ignored" do
    as_user(@student) { patch "/api/v1/feature_settings", headers: @headers, params: { features: { recordings: false } }, as: :json }
    assert_response :forbidden
    as_user(@admin) { patch "/api/v1/feature_settings", headers: @headers, params: { features: { unknown: false } }, as: :json }
    assert_response :success
    assert_empty SchoolSetting.current.features
  end

  test "public catalog mode is available without authentication" do
    %w[automatic always hidden].each do |mode|
      SchoolSetting.current.update!(public_catalog_mode: mode)
      get "/api/v1/course_offerings"
      assert_response :success
      assert_equal mode, response.parsed_body["public_catalog_mode"]
    end
  end

  test "disabled office hours recordings help and meeting booking reject learner calls" do
    SchoolSetting.current.update!(features: FeatureSwitches::KEYS.index_with(false))
    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/office_hours", headers: @headers
      assert_response :forbidden
      get "/api/v1/cohorts/#{@cohort.id}/recordings", headers: @headers
      assert_response :forbidden
      post "/api/v1/help_requests", headers: @headers, params: { help_request: { cohort_id: @cohort.id, context_type: "lesson", context_id: 1 } }, as: :json
      assert_response :forbidden
      get "/api/v1/private_meetings", headers: @headers
      assert_response :success
      assert_empty response.parsed_body["cohorts"]
      get "/api/v1/dashboard", headers: @headers, params: { cohort_id: @cohort.id }
      assert_response :success
      assert_equal false, response.parsed_body.dig("dashboard", "capabilities", "features", "recordings")
      assert_empty response.parsed_body.dig("dashboard", "office_hours")
      post "/api/v1/sessions", headers: @headers
      assert_equal false, response.parsed_body.dig("school", "features", "recordings")
    end
  end

  test "disabled announcements are hidden from lists and direct links" do
    announcement = Announcement.create!(title: "Synthetic update", body: "Practice", author: @admin, audience: :cohort, cohort: @cohort, published_at: Time.current)
    @cohort.update!(settings: { features: { announcements: false } })
    as_user(@student) do
      get "/api/v1/announcements", headers: @headers
      assert_response :success
      assert_empty response.parsed_body["announcements"]
      get "/api/v1/announcements/#{announcement.id}", headers: @headers
      assert_response :forbidden
    end
    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/recordings", headers: @headers }
    assert_response :success
  end

  test "empty feature maps reset school and cohort overrides" do
    as_user(@admin) do
      [ "/api/v1/feature_settings", "/api/v1/cohorts/#{@cohort.id}/feature_settings" ].each do |url|
        patch url, headers: @headers, params: { features: {} }, as: :json
        assert_response :success
      end
    end
  end

  test "cohort deletion preserves feature audit" do
    empty = Cohort.create!(name: "Disposable", curriculum: @cohort.curriculum, start_date: Date.current)
    as_user(@admin) do
      patch "/api/v1/cohorts/#{empty.id}/feature_settings", headers: @headers, params: { features: { recordings: false } }, as: :json
      assert_response :success
      audit = FeatureSwitchChange.last
      delete "/api/v1/cohorts/#{empty.id}", headers: @headers
      assert_response :success
      assert_nil audit.reload.cohort_id
      assert_equal({ "id" => empty.id, "name" => "Disposable" }, audit.after["cohort"])
      assert_equal audit.before["cohort"], audit.after["cohort"]
    end
  end

  test "removed stored keys are ignored" do
    @cohort.update!(settings: { features: { course_community: false, future: false } })
    assert_equal FeatureSwitches::DEFAULTS, FeatureSwitches.for(cohort: @cohort)
  end

  test "disabled learning features permit student lesson completion and preserve content" do
    mod = CurriculumModule.create!(curriculum: @cohort.curriculum, name: "Practice", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Practice", position: 0, release_day: 0)
    checkpoint = lesson.content_blocks.create!(block_type: :checkpoint, position: 0, body: "Keep these instructions")
    checkpoint.create_knowledge_check!(prompt: "Two?", options: [ "1", "2" ], correct_option: 1, explanation: "Two")
    exercise = lesson.content_blocks.create!(block_type: :exercise, position: 1, filename: "practice.rb", submission_type: :prework_github_sync)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: mod, unlocked: true)
    @cohort.update!(settings: { features: { knowledge_checks: false, github_sync: false }, module_github_config: { mod.id.to_s => { requires_github: true } } })
    as_user(@student) do
      get "/api/v1/lessons/#{lesson.id}", headers: @headers, params: { cohort_id: @cohort.id }
      assert_response :success
      blocks = response.parsed_body.dig("lesson", "content_blocks")
      assert_equal "Keep these instructions", blocks.find { |b| b["id"] == checkpoint.id }["body"]
      assert_nil blocks.find { |b| b["id"] == checkpoint.id }["knowledge_check"]
      assert_equal "text_submission", blocks.find { |b| b["id"] == exercise.id }["submission_type"]
      patch "/api/v1/progress", headers: @headers, params: { cohort_id: @cohort.id, content_block_id: checkpoint.id, status: "completed" }, as: :json
      assert_response :success
      post "/api/v1/submissions", headers: @headers, params: { cohort_id: @cohort.id, content_block_id: exercise.id, text: "https://github.com/example/practice" }, as: :json
      assert_response :created
      get "/api/v1/dashboard", headers: @headers, params: { cohort_id: @cohort.id }
      assert_response :success
      assert_equal 100.0, response.parsed_body.dig("dashboard", "overall_progress", "percentage")
      get "/api/v1/cohorts/accessible", headers: @headers
      assert_equal false, response.parsed_body["cohorts"].first.dig("features", "github_sync")
    end
    assert_equal 2, @enrollment.progresses.completed.where(content_block_id: lesson.completion_block_ids).count
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access", headers: @headers, params: { module_id: mod.id, requires_github: false }, as: :json
      assert_response :success
    end
    assert_equal false, @cohort.reload.settings.dig("features", "github_sync")
  end

  test "help history survives withdrawal and access errors do not disclose feature state" do
    request = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: 1, context_label: "Practice", context_path: "/materials", category: :concept, message: "Help")
    @enrollment.update!(status: :dropped)
    as_user(@student) do
      get "/api/v1/help_requests", headers: @headers
      assert_response :success
      assert_equal [ request.id ], response.parsed_body["help_requests"].map { |r| r["id"] }
      [ @cohort.id, 999999 ].each do |id|
        post "/api/v1/help_requests", headers: @headers, params: { help_request: { cohort_id: id, context_type: "lesson", context_id: 1 } }, as: :json
        assert_response :forbidden
        assert_equal "You do not have access to this cohort", response.parsed_body["error"]
      end
    end
    @cohort.update!(settings: { features: { help_requests: false } })
    as_user(@student) { get "/api/v1/help_requests", headers: @headers }
    assert_empty response.parsed_body["help_requests"]
  end

  test "school announcements follow viewer cohort override in list and dashboard" do
    announcement = Announcement.create!(title: "School news", pinned: true, body: "Practice", author: @admin, audience: :global, published_at: Time.current)
    SchoolSetting.current.update!(features: { announcements: false })
    @cohort.update!(settings: { features: { announcements: true } })
    as_user(@student) do
      get "/api/v1/announcements", headers: @headers, params: { cohort_id: @cohort.id }
      assert_includes response.parsed_body["announcements"].map { |a| a["id"] }, announcement.id
      get "/api/v1/dashboard", headers: @headers, params: { cohort_id: @cohort.id }
      assert_includes response.parsed_body.dig("dashboard", "cohort", "announcements").map { |a| a["id"] }, announcement.id
      get "/api/v1/announcements", headers: @headers
      assert_empty response.parsed_body["announcements"]
    end
  end

  test "default dashboard feedback items retain main JSON contract" do
    mod = CurriculumModule.create!(curriculum: @cohort.curriculum, name: "Practice", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Practice", position: 0, release_day: 0)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: mod, unlocked: true)
    %w[R A].each_with_index do |grade, position|
      block = lesson.content_blocks.create!(block_type: :exercise, position: position, submission_type: :text_submission)
      @student.submissions.create!(content_block: block, enrollment: @enrollment, submission_type: :text_submission, text: "Practice", grade: grade, graded_at: Time.current)
    end
    as_user(@student) { get "/api/v1/dashboard", headers: @headers, params: { cohort_id: @cohort.id } }
    assert_response :success
    dashboard = response.parsed_body["dashboard"]
    assert_equal %w[type submission_id content_block_id submission_type cohort_id lesson_id lesson_title content_block_title feedback submission_window submissions_closed].sort, dashboard["action_items"].first.keys.sort
    assert_equal %w[submission_id content_block_id cohort_id lesson_id lesson_title content_block_title grade feedback graded_at].sort, dashboard["recently_graded"].first.keys.sort
  end

  test "cohort settings writers preserve saved feature overrides" do
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers, params: { features: { recordings: false } }, as: :json
      %w[announcements class_resources].each do |key|
        patch "/api/v1/cohorts/#{@cohort.id}/#{key}", headers: @headers, params: { key => [] }, as: :json
        assert_response :success
        assert_equal false, @cohort.reload.settings.dig("features", "recordings")
      end
    end
  end

  private

  def as_user(user, &block)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    @headers = { "Authorization" => "Bearer test_token" }
    block.call
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

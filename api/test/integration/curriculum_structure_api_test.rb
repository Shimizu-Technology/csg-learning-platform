require "test_helper"

class CurriculumStructureApiTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Mobile curriculum", total_weeks: 14, status: :active)
    @curriculum_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Live Class",
      module_type: :live_class,
      position: 0,
      schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(
      curriculum_module: @curriculum_module,
      title: "Responsive layouts",
      lesson_type: :exercise,
      position: 0,
      release_day: 0
    )
    @lesson.content_blocks.create!(block_type: :exercise, position: 1, title: @lesson.title, body: "Build a grid.")
    @admin = User.create!(clerk_id: "curriculum_structure_admin", email: "structure-admin@example.com", first_name: "Admin", last_name: "Editor", role: :admin)
    @instructor = User.create!(clerk_id: "curriculum_structure_instructor", email: "structure-instructor@example.com", first_name: "Instructor", last_name: "Editor", role: :instructor)
  end

  test "widening preserves existing lesson release days and narrowing still rejects restorable lessons" do
    @curriculum_module.update!(schedule_days: "mwf")
    @lesson.update!(release_day: 2)
    archived = @curriculum_module.lessons.create!(title: "Archived Friday", lesson_type: :exercise, position: 2, release_day: 4, archived_at: Time.current)
    before_days = @curriculum_module.lessons.order(:id).pluck(:release_day)

    as_user(@admin) do
      patch "/api/v1/modules/#{@curriculum_module.id}", params: { schedule_days: "weekdays", base_updated_at: @curriculum_module.updated_at.iso8601(6) }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal before_days, @curriculum_module.lessons.order(:id).pluck(:release_day)
    assert_equal 4, archived.reload.release_day

    as_user(@admin) do
      patch "/api/v1/modules/#{@curriculum_module.id}", params: { schedule_days: "tth", base_updated_at: @curriculum_module.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors").join, "would exclude 2 restorable lessons"
    assert_equal "weekdays", @curriculum_module.reload.schedule_days
    assert_equal before_days, @curriculum_module.lessons.order(:id).pluck(:release_day)
  end

  test "staff curriculum detail includes exact resource versions for safe mobile edits" do
    as_user(@instructor) do
      get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body).fetch("curriculum")
    assert_equal @curriculum.updated_at.iso8601(6), body.fetch("updated_at")
    mod = body.fetch("modules").first
    assert_equal @curriculum_module.updated_at.iso8601(6), mod.fetch("updated_at")
    assert_equal @lesson.updated_at.iso8601(6), mod.fetch("lessons").first.fetch("updated_at")
  end

  test "admin can create and version-update modules while instructors cannot change structure" do
    as_user(@admin) do
      post "/api/v1/curricula/#{@curriculum.id}/modules",
        params: { name: "Prework", module_type: "prework", position: 1, schedule_days: "weekdays_sat" },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    created = CurriculumModule.find(JSON.parse(response.body).dig("module", "id"))
    base_updated_at = created.updated_at.iso8601(6)

    as_user(@admin) do
      patch "/api/v1/modules/#{created.id}",
        params: { name: "Updated Prework", base_updated_at: base_updated_at },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_equal "Updated Prework", created.reload.name

    as_user(@instructor) do
      patch "/api/v1/modules/#{created.id}",
        params: { name: "Instructor overwrite", base_updated_at: created.updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
    assert_equal "Updated Prework", created.reload.name
  end

  test "module updates reject a stale mobile version without overwriting newer work" do
    stale_version = @curriculum_module.updated_at.iso8601(6)
    @curriculum_module.update!(name: "Newer web name")

    as_user(@admin) do
      patch "/api/v1/modules/#{@curriculum_module.id}",
        params: { name: "Stale phone name", base_updated_at: stale_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal "stale_resource", JSON.parse(response.body).fetch("code")
    assert_equal "Newer web name", @curriculum_module.reload.name
  end

  test "curriculum updates accept the current version and reject missing or stale versions" do
    current_version = @curriculum.updated_at.iso8601(6)

    as_user(@admin) do
      patch "/api/v1/curricula/#{@curriculum.id}",
        params: { description: "Current description", base_updated_at: current_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_equal "Current description", @curriculum.reload.description
    accepted_version = JSON.parse(response.body).dig("curriculum", "updated_at")

    as_user(@admin) do
      patch "/api/v1/curricula/#{@curriculum.id}",
        params: { description: "Missing-version overwrite" },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal "stale_resource", JSON.parse(response.body).fetch("code")
    assert_equal "Current description", @curriculum.reload.description

    @curriculum.update!(description: "Newer description")
    as_user(@admin) do
      patch "/api/v1/curricula/#{@curriculum.id}",
        params: { description: "Stale overwrite", base_updated_at: accepted_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal "stale_resource", JSON.parse(response.body).fetch("code")
    assert_equal "Newer description", @curriculum.reload.description
  end

  test "structure updates require a resource version and leave records unchanged when it is missing" do
    original_module_name = @curriculum_module.name
    original_release_day = @lesson.release_day

    as_user(@admin) do
      patch "/api/v1/modules/#{@curriculum_module.id}",
        params: { name: "Unversioned module overwrite" },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal "stale_resource", JSON.parse(response.body).fetch("code")
    assert_equal original_module_name, @curriculum_module.reload.name

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}",
        params: { release_day: 3 },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal "stale_resource", JSON.parse(response.body).fetch("code")
    assert_equal original_release_day, @lesson.reload.release_day
  end

  test "lesson placement rejects a stale version and returns full content after a current update" do
    stale_version = @lesson.updated_at.iso8601(6)
    @lesson.update!(title: "Newer web title")

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}",
        params: { release_day: 1, base_updated_at: stale_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal 0, @lesson.reload.release_day

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}",
        params: { release_day: 1, base_updated_at: @lesson.updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    lesson = JSON.parse(response.body).fetch("lesson")
    assert_equal 1, lesson.fetch("release_day")
    assert_equal "Build a grid.", lesson.fetch("content_blocks").first.fetch("body")
  end

  test "archive and restore honor supplied lesson versions" do
    stale_version = @lesson.updated_at.iso8601(6)
    @lesson.touch

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/archive",
        params: { base_updated_at: stale_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    refute @lesson.reload.archived?

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/archive",
        params: { base_updated_at: @lesson.updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    archived_version = JSON.parse(response.body).dig("lesson", "updated_at")
    assert @lesson.reload.archived?

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/restore",
        params: { base_updated_at: archived_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    refute @lesson.reload.archived?
  end

  test "create defaults to draft and curriculum index has validated populated content" do
    as_user(@admin) do
      post "/api/v1/curricula", params: { name: "Synthetic draft" }, headers: auth_headers, as: :json
      assert_response :created
      assert_equal "draft", response.parsed_body.dig("curriculum", "status")
      get "/api/v1/curricula", headers: auth_headers
      assert_response :success
      assert response.parsed_body.fetch("curricula").any?
    end
  end

  test "curriculum transitions validate status and archive guards" do
    as_user(@admin) do
      %w[draft active].each do |status|
        patch "/api/v1/curricula/#{@curriculum.id}", params: { status: status, base_updated_at: @curriculum.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
        assert_response :success
        assert_equal status, @curriculum.reload.status
      end
      patch "/api/v1/curricula/#{@curriculum.id}", params: { status: "unknown", base_updated_at: @curriculum.updated_at.iso8601(6) }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      cohort = Cohort.create!(name: "Synthetic cohort", curriculum: @curriculum, start_date: Date.current, status: :active)
      patch "/api/v1/curricula/#{@curriculum.id}", params: { status: "archived", base_updated_at: @curriculum.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      cohort.update!(status: :completed, public_checkout_enabled: true, course_delivery: "self_paced")
      patch "/api/v1/curricula/#{@curriculum.id}", params: { status: "archived", base_updated_at: @curriculum.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      cohort.update!(public_checkout_enabled: false)
      patch "/api/v1/curricula/#{@curriculum.id}", params: { status: "archived", base_updated_at: @curriculum.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
      assert_response :success
    end
  end

  test "reorder requires every module exactly once and admin authority" do
    other = @curriculum.modules.create!(name: "Second", position: 1)
    as_user(@admin) do
      post "/api/v1/curricula/#{@curriculum.id}/modules/reorder", params: { module_ids: [ other.id, @curriculum_module.id ] }, headers: auth_headers, as: :json
      assert_response :no_content
      assert_equal [ other.id, @curriculum_module.id ], @curriculum.modules.reload.ids
      [ [ other.id ], [ other.id, other.id ], [ other.id, 999999 ], "invalid" ].each do |ids|
        post "/api/v1/curricula/#{@curriculum.id}/modules/reorder", params: { module_ids: ids }, headers: auth_headers, as: :json
        assert_response :unprocessable_entity
        assert_equal [ other.id, @curriculum_module.id ], @curriculum.modules.reload.ids
      end
    end
    student = User.create!(clerk_id: "structure_student", email: "structure-student@example.invalid", first_name: "Synthetic", last_name: "Learner", role: :student)
    [ @instructor, student ].each do |user|
      as_user(user) do
        post "/api/v1/curricula/#{@curriculum.id}/modules/reorder", params: { module_ids: [ other.id, @curriculum_module.id ] }, headers: auth_headers, as: :json
        assert_response :forbidden
        patch "/api/v1/curricula/#{@curriculum.id}", params: { status: "draft" }, headers: auth_headers, as: :json
        assert_response :forbidden
        delete "/api/v1/modules/#{other.id}", headers: auth_headers
        assert_response :forbidden
      end
    end
  end

  test "module deletion retains archived lesson submissions and progress" do
    block = @lesson.content_blocks.first
    @lesson.archive!
    submission = Submission.create!(content_block: block, user: @instructor)
    as_user(@admin) do
      delete "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
      assert_response :unprocessable_entity
      assert Submission.exists?(submission.id)
      assert Lesson.exists?(@lesson.id)
      submission.destroy!
      progress = Progress.create!(content_block: block, user: @instructor)
      delete "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
      assert_response :unprocessable_entity
      assert Progress.exists?(progress.id)
      progress.destroy!
      delete "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
      assert_response :no_content
    end
  end


  %w[module_assignment lesson_assignment knowledge_check_attempt].each do |evidence_type|
    test "module deletion preserves isolated #{evidence_type}" do
      cohort = Cohort.create!(name: "Evidence cohort", curriculum: @curriculum, start_date: Date.current)
      enrollment = Enrollment.create!(cohort: cohort, user: @instructor)
      enrollment.module_assignments.destroy_all
      enrollment.lesson_assignments.destroy_all
      evidence = case evidence_type
      when "module_assignment"
        enrollment.module_assignments.create!(curriculum_module: @curriculum_module)
      when "lesson_assignment"
        enrollment.lesson_assignments.create!(lesson: @lesson)
      else
        block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 3)
        check = KnowledgeCheck.create!(content_block: block, prompt: "Which?", options: %w[a b], correct_option: 0, explanation: "a")
        KnowledgeCheckAttempt.create!(knowledge_check: check, user: @instructor, selected_option: 0, correct: true)
      end
      as_user(@admin) do
        get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers
        assert_response :success
        assert response.parsed_body.dig("curriculum", "modules").find { |mod| mod["id"] == @curriculum_module.id }.fetch("deletion_blocked")
        delete "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
        assert_response :unprocessable_entity
      end
      assert_includes response.parsed_body.fetch("errors").join, "Cannot delete a module with learner data"
      assert evidence.class.exists?(evidence.id)
      assert CurriculumModule.exists?(@curriculum_module.id)
      assert Lesson.exists?(@lesson.id)
    end
  end

  test "detail evidence queries stay flat from one to five modules" do
    count_queries = lambda do
      ActiveRecord::Base.connection.clear_query_cache
      queries = []
      callback = ->(_name, _start, _finish, _id, payload) { queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:cached] || payload[:sql].match?(/BEGIN|COMMIT|SAVEPOINT|RELEASE/) }
      ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
        as_user(@admin) { get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers }
      end
      assert_response :success
      queries.length
    end
    count_queries.call # Warm schema metadata.
    one = count_queries.call
    4.times { |i| @curriculum.modules.create!(name: "Extra #{i}", position: i + 1) }
    assert_equal one, count_queries.call
  end

  test "API lists affected offerings and rejects archived curriculum on cohort create but accepts draft" do
    offering = Cohort.create!(name: "Live checkout", curriculum: @curriculum, start_date: Date.current, status: :active, course_delivery: "self_paced", public_checkout_enabled: true)
    as_user(@admin) do
      get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers
      assert_equal [ { "id" => offering.id, "name" => offering.name } ], response.parsed_body.dig("curriculum", "live_checkout_offerings")
      offering.update!(status: :completed, public_checkout_enabled: false)
      @curriculum.update!(status: :archived)
      post "/api/v1/cohorts", params: { name: "New", curriculum_id: @curriculum.id, start_date: Date.current }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      @curriculum.update!(status: :draft)
      post "/api/v1/cohorts", params: { name: "New draft", curriculum_id: @curriculum.id, start_date: Date.current }, headers: auth_headers, as: :json
      assert_response :created
    end
  end

  test "checkout enable rechecks archived curriculum under the curriculum lock" do
    cohort = Cohort.create!(name: "Closed", curriculum: @curriculum, start_date: Date.current, status: :completed, course_delivery: "self_paced")
    @curriculum.update!(status: :archived)
    as_user(@admin) do
      patch "/api/v1/cohorts/#{cohort.id}", params: { public_checkout_enabled: true }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
    end
    refute cohort.reload.public_checkout_enabled?
  end


  test "module deletion metadata is visible only to staff" do
    student = User.create!(clerk_id: "metadata_student", email: "metadata@example.invalid", first_name: "Test", last_name: "Student", role: :student)
    cohort = Cohort.create!(name: "Metadata", curriculum: @curriculum, start_date: Date.current, status: :active)
    enrollment = Enrollment.create!(cohort: cohort, user: student)
    enrollment.module_assignments.find_or_create_by!(curriculum_module: @curriculum_module).update!(unlocked: true)
    as_user(student) do
      get "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
      assert_response :success
      refute response.parsed_body.fetch("module").key?("submissions_count")
      refute response.parsed_body.fetch("module").key?("deletion_blocked")
    end
    as_user(@instructor) do
      get "/api/v1/modules/#{@curriculum_module.id}", headers: auth_headers
      assert_response :success
      assert response.parsed_body.fetch("module").key?("submissions_count")
      assert response.parsed_body.fetch("module").key?("deletion_blocked")
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end

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

    as_user(@instructor) do
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

    as_user(@instructor) do
      patch "/api/v1/lessons/#{@lesson.id}",
        params: { release_day: 1, base_updated_at: stale_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_equal 0, @lesson.reload.release_day

    as_user(@instructor) do
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

    as_user(@instructor) do
      patch "/api/v1/lessons/#{@lesson.id}/archive",
        params: { base_updated_at: stale_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    refute @lesson.reload.archived?

    as_user(@instructor) do
      patch "/api/v1/lessons/#{@lesson.id}/archive",
        params: { base_updated_at: @lesson.updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    archived_version = JSON.parse(response.body).dig("lesson", "updated_at")
    assert @lesson.reload.archived?

    as_user(@instructor) do
      patch "/api/v1/lessons/#{@lesson.id}/restore",
        params: { base_updated_at: archived_version },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    refute @lesson.reload.archived?
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

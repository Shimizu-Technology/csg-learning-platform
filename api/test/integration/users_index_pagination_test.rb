require "test_helper"

# R-3: GET /api/v1/users stays a full list by default, because every current
# web and mobile caller (including installed mobile builds) reads the whole
# list. Sending page or per_page opts in to one page plus a meta block.
class UsersIndexPaginationTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "Directory curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Directory cohort", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Elsewhere cohort", start_date: Date.current, status: :active)
    @admin = person("Admin", "Zed", :admin)
    @instructor = person("Teach", "Zz", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    # Same last and first names, so only the id tie-break orders them.
    @students = 7.times.map { |i| person("Sam", "Same", :student, suffix: i) }
    @students.each { |student| Enrollment.create!(user: student, cohort: @cohort, status: :active) }
    Enrollment.create!(user: @students.first, cohort: @other_cohort, status: :active)
  end

  test "without page params the full list comes back with no meta" do
    users = index(@admin, role: "student")

    assert_equal @students.map(&:id), users.fetch("users").map { |user| user["id"] }
    refute users.key?("meta")
  end

  test "pages walk the same order as the full list" do
    full = index(@admin, role: "student").fetch("users").map { |user| user["id"] }
    first = index(@admin, role: "student", per_page: 3)
    second = index(@admin, role: "student", per_page: 3, page: 2)
    third = index(@admin, role: "student", per_page: 3, page: 3)

    assert_equal full, [ first, second, third ].flat_map { |body| body.fetch("users").map { |user| user["id"] } }
    assert_equal({ "page" => 1, "per_page" => 3, "total_count" => 7, "total_pages" => 3, "has_next_page" => true, "has_prev_page" => false }, first.fetch("meta"))
    assert_equal({ "page" => 3, "per_page" => 3, "total_count" => 7, "total_pages" => 3, "has_next_page" => false, "has_prev_page" => true }, third.fetch("meta"))
  end

  test "page alone uses the default page size and per_page is capped" do
    assert_equal Api::V1::UsersController::USERS_PER_PAGE, index(@admin, page: 1).dig("meta", "per_page")
    assert_equal Api::V1::UsersController::MAX_USERS_PER_PAGE, index(@admin, per_page: 10_000).dig("meta", "per_page")
    assert_equal 1, index(@admin, per_page: 0).dig("meta", "per_page")
    assert_equal [], index(@admin, role: "student", per_page: 5, page: 9).fetch("users")
  end

  test "instructors still see only enrollments in cohorts they teach" do
    body = index(@instructor, role: "student", include_enrollments: true, per_page: 2)
    first = body.fetch("users").first

    assert_equal @students.first.id, first["id"]
    assert_equal [ @cohort.id ], first.fetch("enrollments").map { |enrollment| enrollment["cohort_id"] }
    assert_equal 7, body.dig("meta", "total_count")

    admin_view = index(@admin, role: "student", include_enrollments: true).fetch("users").first
    assert_equal [ @cohort.id, @other_cohort.id ].sort, admin_view.fetch("enrollments").map { |enrollment| enrollment["cohort_id"] }.sort
  end

  test "the user payload keeps its fields" do
    user = index(@admin, role: "student", include_enrollments: true).fetch("users").first

    assert_equal %w[
      archived_at avatar_url created_at email enrollments first_name full_name github_username handle id
      invite_delivery_status invite_expires_at invite_last_error invite_pending invite_sent_at invite_state
      last_name last_seen_at last_sign_in_at role
    ], user.keys.sort
    assert_equal %w[access_expires_at cohort_id cohort_name cohort_status completed_at enrolled_at id status],
      user.fetch("enrollments").first.keys.sort
  end

  test "an instructor's users show lists only enrollments in cohorts they teach" do
    as_user(@instructor) { get "/api/v1/users/#{@students.first.id}", headers: auth_headers }

    assert_response :success
    assert_equal [ @cohort.id ], response.parsed_body.fetch("enrollments").map { |enrollment| enrollment["cohort_id"] }

    outsider = person("Out", "Sider", :student)
    Enrollment.create!(user: outsider, cohort: @other_cohort, status: :active)
    as_user(@instructor) { get "/api/v1/users/#{outsider.id}", headers: auth_headers }
    assert_response :forbidden
  end

  private

  def index(user, **params)
    as_user(user) { get "/api/v1/users", params: params, headers: auth_headers }
    assert_response :success
    response.parsed_body
  end

  def person(first, last, role, suffix: nil)
    key = [ first, last, suffix ].compact.join("-").downcase
    User.create!(clerk_id: "directory_#{key}", email: "directory-#{key}@example.com", first_name: first, last_name: last, role: role)
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

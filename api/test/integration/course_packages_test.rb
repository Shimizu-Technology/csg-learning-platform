require "test_helper"
require_relative "../support/course_package_fixture"

class CoursePackagesTest < ActionDispatch::IntegrationTest
  include CoursePackageFixture
  def setup
    @admin = User.create!(clerk_id: "package-admin", email: "package-admin@example.com", role: :admin)
    @instructor = User.create!(clerk_id: "package-instructor", email: "package-instructor@example.com", role: :instructor)
    @student = User.create!(clerk_id: "package-student", email: "package-student@example.com", role: :student)
    @package = package
  end

  test "only admin can preview or import and response does not expose solutions" do
    [ @student, @instructor ].each do |user|
      as_user(user) { post "/api/v1/course_packages/preview", params: { package: @package }, headers: auth_headers, as: :json }
      assert_response :forbidden
      as_user(user) { post "/api/v1/course_packages", params: { package: @package }, headers: auth_headers, as: :json }
      assert_response :forbidden
    end
    as_user(@admin) { post "/api/v1/course_packages/preview", params: { package: @package }, headers: auth_headers, as: :json }
    assert_response :success
    refute_includes response.body, "Staff answer"
    as_user(@admin) { post "/api/v1/course_packages", params: { package: @package }, headers: auth_headers, as: :json }
    assert_response :created
    assert Curriculum.find(JSON.parse(response.body).dig("import", "curriculum_id")).draft?
    refute_includes response.body, "Staff answer"
  end

  test "learner reading imported content cannot see the staff solution" do
    imported = CoursePackageImporter.new(@package).call
    curriculum = Curriculum.find(imported[:curriculum_id])
    cohort = Cohort.create!(curriculum: curriculum, name: "Package learner QA", start_date: Date.current - 2, end_date: Date.current + 18)
    enrollment = Enrollment.create!(user: @student, cohort: cohort, status: :active)
    mod = curriculum.modules.first
    enrollment.module_assignments.find_or_create_by!(curriculum_module: mod) { |assignment| assignment.unlocked = true }
    lesson = mod.lessons.last
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", headers: auth_headers }
    assert_response :success
    refute_includes response.body, "Staff answer"
    refute JSON.parse(response.body).dig("lesson", "content_blocks", 0).key?("solution")
    as_user(@student) { get "/api/v1/content_blocks/#{lesson.content_blocks.first.id}", headers: auth_headers }
    assert_response :forbidden
  end

  test "malformed and oversized packages are rejected without mutation" do
    [ nil, "bad", {}, { schema_version: 99 }, { body: "x" * (CoursePackageImporter::MAX_BYTES + 1) } ].each do |data|
      assert_no_difference "Curriculum.count" do
        as_user(@admin) { post "/api/v1/course_packages", params: { package: data }, headers: auth_headers, as: :json }
      end
      assert_response :unprocessable_entity
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

require_relative "fake_github_app_client"

module GithubAppFixtures
  def stub_app_method(target, name, value)
    original = target.method(name)
    target.define_singleton_method(name) { |*args, **kwargs| value }
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  def build_github_app_fixture
    @admin = User.create!(clerk_id: "app-admin", email: "app-admin@example.invalid", role: :admin)
    @instructor = User.create!(clerk_id: "app-instructor", email: "app-instructor@example.invalid", role: :instructor)
    @student = User.create!(clerk_id: "app-student", email: "app-student@example.invalid", role: :student, github_username: "app-learner")
    @other = User.create!(clerk_id: "app-other", email: "app-other@example.invalid", role: :student)
    @curriculum = Curriculum.create!(name: "App curriculum")
    @mod = @curriculum.modules.create!(name: "App module", position: 0)
    @lesson = @mod.lessons.create!(title: "App lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "111.rb", position: 0)
    @cohort = Cohort.create!(name: "App cohort", curriculum: @curriculum, start_date: Date.current, status: :active, repository_name: "prework-exercises", settings: { features: { github_app: true } })
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active)
    SchoolSetting.current.update!(features: { github_app: true })
    @installation = @cohort.github_app_installations.create!(app_id: 12345, installation_id: 123, account_id: 456, account_login: "app-learner", account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current)
    @binding = @enrollment.github_repository_bindings.create!(github_app_installation: @installation, full_name: "app-learner/prework-exercises")
    @fake = FakeGithubAppClient.new
  end

  def with_app_provider(&block)
    stub_app_method(GithubAppClient, :new, @fake) do
      stub_app_method(GithubAppCredentials, :app_id, "12345") do
        stub_app_method(GithubAppCredentials, :slug, "synthetic-app") do
          stub_app_method(GithubAppCredentials, :configured?, true, &block)
        end
      end
    end
  end

  def as_app_user(user)
    stub_app_method(ClerkAuth, :verify, { "sub" => user.clerk_id, "email" => user.email }) { yield }
  end

  def app_headers = { "Authorization" => "Bearer synthetic-test" }
  def bindings_path(enrollment = @enrollment) = "/api/v1/enrollments/#{enrollment.id}/github_repository_bindings"
  def installations_path(cohort = @cohort) = "/api/v1/cohorts/#{cohort.id}/github_app_installations"
end

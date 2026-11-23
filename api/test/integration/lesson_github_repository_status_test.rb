require "test_helper"
require_relative "../support/github_app_fixtures"

class LessonGithubRepositoryStatusTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  setup do
    build_github_app_fixture
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
  end

  test "only a currently verified effective binding can expose its repository and saved revisions" do
    assert_equal({ "state" => "needs_verification", "scope" => "course" }, lesson_status)
    verify(@binding, repository_id: 101)
    assert_equal({ "state" => "verified", "scope" => "course", "full_name" => @binding.full_name, "revisions" => [] }, lesson_status)

    other_block = @lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "112.rb", position: 1)
    snapshot(@block, @binding, sha: "a" * 40, captured_at: 2.hours.ago)
    latest_capture = 1.hour.ago
    snapshot(@block, @binding, sha: "b" * 40, captured_at: latest_capture)
    other_capture = 30.minutes.ago
    snapshot(other_block, @binding, sha: "c" * 40, captured_at: other_capture)
    assert_equal(
      [
        { "block_id" => @block.id, "captured_at" => latest_capture.utc.iso8601(6), "short_sha" => "bbbbbbb" },
        { "block_id" => other_block.id, "captured_at" => other_capture.utc.iso8601(6), "short_sha" => "ccccccc" }
      ],
      lesson_status.fetch("revisions")
    )

    override = @enrollment.github_repository_bindings.create!(github_app_installation: @installation, full_name: "app-learner/module-work", curriculum_module: @mod)
    assert_equal({ "state" => "needs_verification", "scope" => "module" }, lesson_status)
    verify(override, repository_id: 102)
    assert_equal({ "state" => "verified", "scope" => "module", "full_name" => override.full_name, "revisions" => [] }, lesson_status)
    snapshot(@block, override, sha: "d" * 40, captured_at: Time.current)
    assert_equal [ "ddddddd" ], lesson_status.fetch("revisions").pluck("short_sha")

    @installation.update!(connection_state: "failed")
    assert_equal({ "state" => "needs_verification", "scope" => "module" }, lesson_status)
    @installation.update!(connection_state: "connected")
    @student.record_verified_github_identity!(id: "999", login: "renamed-learner")
    assert_equal({ "state" => "needs_verification", "scope" => "module" }, lesson_status)
  end

  test "a shared lesson uses only the selected enrollment and omits status for staff or disabled features" do
    verify(@binding, repository_id: 101)
    snapshot(@block, @binding, sha: "a" * 40, captured_at: Time.current)
    other_cohort = @cohort.dup
    other_cohort.name = "Unrelated cohort with shared lesson"
    other_cohort.save!

    as_app_user(@student) { get lesson_path(other_cohort), headers: app_headers }
    assert_response :forbidden
    refute_includes response.body, @binding.full_name

    Enrollment.create!(cohort: other_cohort, user: @student, status: :active)
      .module_assignments.create!(curriculum_module: @mod, unlocked: true)
    assert_equal({ "state" => "needs_repository" }, lesson_status(cohort: other_cohort))
    assert_equal [ "aaaaaaa" ], lesson_status.fetch("revisions").pluck("short_sha")

    assert_nil lesson_status(user: @instructor)
    [ { github_app: false }, { github_app: true, github_sync: false } ].each do |features|
      @cohort.update!(settings: { features: features })
      assert_nil lesson_status
    end
  end

  private

  def lesson_path(cohort)
    "/api/v1/lessons/#{@lesson.id}?cohort_id=#{cohort.id}"
  end

  def lesson_status(cohort: @cohort, user: @student)
    as_app_user(user) { get lesson_path(cohort), headers: app_headers }
    assert_response :success
    response.parsed_body.dig("lesson", "github_repository_status")
  end

  def verify(binding, repository_id:)
    binding.update!(verification_state: "verified", verified_at: Time.current, repository_id: repository_id,
      github_user_id: @student.github_user_id, github_username: @student.github_verified_login)
  end

  def snapshot(block, binding, sha:, captured_at:)
    Submission.create!(content_block: block, user: @student, enrollment: @enrollment, submission_type: :prework_github_sync,
      commit_sha: sha, github_repository_id: binding.repository_id, github_revision: {
        version: 1, binding_id: binding.id, repository_id: binding.repository_id, repository_full_name: binding.full_name,
        captured_at: captured_at.iso8601(6)
      })
  end
end

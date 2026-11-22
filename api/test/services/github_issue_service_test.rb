require "test_helper"

class GithubIssueServiceTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Git Basics", position: 0, release_day: 0)
    @block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 0, title: "Exercise 1", body: "Do stuff"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active,
      repository_name: "cohort-3-prework"
    )
    @student = User.create!(
      clerk_id: "clerk_gh_test", email: "gh_test@example.com",
      first_name: "Student", last_name: "One", role: :student,
      github_username: "student-one"
    )
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @submission = Submission.create!(user: @student, content_block: @block, text: "code")
  end

  test "handle_grade returns nil when token is blank" do
    result = GithubIssueService.handle_grade(
      submission: @submission, grade: "R", feedback: "Redo", token: ""
    )
    assert_nil result
  end

  test "handle_grade returns nil when user has no github_username" do
    @student.update!(github_username: nil)
    result = GithubIssueService.handle_grade(
      submission: @submission, grade: "R", feedback: "Redo", token: "test"
    )
    assert_nil result
  end

  test "handle_grade returns nil when user has no active cohort" do
    Enrollment.where(user: @student).destroy_all
    result = GithubIssueService.handle_grade(
      submission: @submission, grade: "R", feedback: "Redo", token: "test"
    )
    assert_nil result
  end

  test "resolve_repo uses module-level config when present" do
    @cohort.update!(settings: {
      "module_github_config" => {
        @mod.id.to_s => { "repository_name" => "custom-repo" }
      }
    })

    repo = GithubIssueService.send(:resolve_repo, @cohort, @mod)
    assert_equal "custom-repo", repo
  end

  test "resolve_repo falls back to cohort repository_name" do
    repo = GithubIssueService.send(:resolve_repo, @cohort, @mod)
    assert_equal "cohort-3-prework", repo
  end

  test "build_issue_body includes exercise title, lesson title, and feedback" do
    body = GithubIssueService.send(:build_issue_body, @block, @lesson, "Fix your code")
    assert_includes body, "Exercise 1"
    assert_includes body, "Git Basics"
    assert_includes body, "Fix your code"
  end

  test "find_prior_issue_url finds github_issue_url from prior submission" do
    @submission.update_column(:github_issue_url, "https://github.com/student-one/cohort-3-prework/issues/42")
    resubmission = Submission.create!(user: @student, content_block: @block, text: "fixed code", num_submissions: 2)

    url = GithubIssueService.send(:find_prior_issue_url, resubmission)
    assert_equal "https://github.com/student-one/cohort-3-prework/issues/42", url
  end

  test "find_prior_issue_url returns nil when no prior issue exists" do
    url = GithubIssueService.send(:find_prior_issue_url, @submission)
    assert_nil url
  end

  test "handle_grade targets the submission enrollment cohort and isolates prior issues across active cohorts" do
    cohort_two = Cohort.create!(
      curriculum: @curriculum, name: "Cohort Two", start_date: Date.current + 1.day, status: :active,
      repository_name: "cohort-two-prework"
    )
    enrollment_one = Enrollment.find_by!(user: @student, cohort: @cohort)
    enrollment_two = Enrollment.create!(user: @student, cohort: cohort_two, status: :active)

    prior_one = Submission.create!(
      user: @student, enrollment: enrollment_one, content_block: @block, text: "c1",
      github_issue_url: "https://github.com/student-one/cohort-3-prework/issues/11"
    )
    assert prior_one.github_issue_url.present?

    sub_two = Submission.create!(
      user: @student, enrollment: enrollment_two, content_block: @block, text: "c2"
    )

    posted = []
    patched = []
    fake_response = Struct.new(:code, :parsed_response) { def success? = code.between?(200, 299) }
    original_post = HTTParty.method(:post)
    original_patch = HTTParty.method(:patch)
    HTTParty.define_singleton_method(:post) do |url, **opts|
      posted << [ url, opts ]
      fake_response.new(201, { "html_url" => "https://github.com/student-one/cohort-two-prework/issues/3" })
    end
    HTTParty.define_singleton_method(:patch) do |url, **opts|
      patched << [ url, opts ]
      fake_response.new(200, { "state" => "closed" })
    end

    # Passing grade in Cohort Two must NOT close Cohort One's issue
    GithubIssueService.handle_grade(submission: sub_two, grade: "A", feedback: "Great!", token: "tok")
    assert_empty posted
    assert_empty patched

    # Redo grade in Cohort Two must create on Cohort Two's repo, not Cohort One's repo or issue
    GithubIssueService.handle_grade(submission: sub_two, grade: "R", feedback: "Fix loop", token: "tok")
    assert_equal 1, posted.size
    assert_equal "https://api.github.com/repos/student-one/cohort-two-prework/issues", posted.first.first
    assert_equal "https://github.com/student-one/cohort-two-prework/issues/3", sub_two.reload.github_issue_url
    assert_equal "https://github.com/student-one/cohort-3-prework/issues/11", prior_one.reload.github_issue_url
  ensure
    HTTParty.define_singleton_method(:post, original_post) if original_post
    HTTParty.define_singleton_method(:patch, original_patch) if original_patch
  end
end

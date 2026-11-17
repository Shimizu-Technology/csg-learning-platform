require "test_helper"
require_relative "../support/query_counter"

class SubmissionAuditTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @admin = User.create!(clerk_id: "audit-admin", email: "audit-admin@example.invalid", role: :admin)
    @student = User.create!(clerk_id: "audit-student", email: "audit-student@example.invalid", role: :student)
    @curriculum = Curriculum.create!(name: "Audit lab")
    @module = @curriculum.modules.create!(name: "MWF", position: 0, schedule_days: "mwf")
    @lesson = @module.lessons.create!(title: "Build a site", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Deploy your site", body: "Create a repo and push your work.", position: 0, submission_type: :manual_complete)
  end

  test "admin audit counts distinct learners and review preserves progress and reopens changed content" do
    progress = Progress.create!(user: @student, content_block: @block, status: :completed)
    before = progress.attributes
    as_user(@admin) do
      get "/api/v1/submission_audits", headers: headers
      assert_response :success
      row = response.parsed_body.fetch("blocks").find { |item| item["id"] == @block.id }
      assert_equal 1, row["completed_learners"]
      assert_equal "repo_and_live_url_submission", row["suggested_type"]
      patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: row["content_digest"] }, headers: headers, as: :json
      assert_response :success
      assert_equal @admin.id, response.parsed_body["reviewed_by_id"]
      assert_equal before, progress.reload.attributes
      assert_equal "manual_complete", @block.reload.submission_type
      get "/api/v1/submission_audits", headers: headers
      assert_empty response.parsed_body["blocks"]
      @block.update!(body: "Submit a screenshot instead.")
      get "/api/v1/submission_audits", headers: headers
      assert_equal [ @block.id ], response.parsed_body["blocks"].map { |item| item["id"] }
      patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: row["content_digest"] }, headers: headers, as: :json
      assert_response :conflict
    end
  end

  test "students and instructors cannot list or dismiss" do
    instructor = User.create!(clerk_id: "audit-instructor", email: "audit-instructor@example.invalid", role: :instructor)
    [ @student, instructor ].each do |user|
      as_user(user) do
        get "/api/v1/submission_audits", headers: headers
        assert_response :forbidden
        patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: SubmissionAudit.digest(@block) }, headers: headers, as: :json
        assert_response :forbidden
      end
    end
    assert_empty SubmissionAuditReview.all
  end

  test "ignores configured submissions archived lessons and nonmatching prose" do
    @lesson.content_blocks.create!(block_type: :exercise, position: 1, body: "Build something", submission_type: :text_submission)
    @lesson.content_blocks.create!(block_type: :text, position: 2, body: "Read about variables", submission_type: nil)
    prework = @curriculum.modules.create!(name: "Prework", position: 1, module_type: :prework)
    legacy = prework.lessons.create!(title: "Legacy sync", position: 0, release_day: 0)
    legacy.content_blocks.create!(block_type: :exercise, position: 0, body: "Push your work", filename: "111.rb", submission_type: nil)
    assert_equal [ @block.id ], SubmissionAudit.rows.map { |row| row[:id] }
    @lesson.update!(archived_at: Time.current)
    assert_empty SubmissionAudit.rows
  end

  test "query counts stay flat across curricula modules lessons and blocks" do
    SubmissionAudit.rows
    small = count_queries { SubmissionAudit.rows }
    5.times do |index|
      curriculum = Curriculum.create!(name: "Other #{index}")
      mod = curriculum.modules.create!(name: "Other", position: 0)
      lesson = mod.lessons.create!(title: "Other", position: 0, release_day: 0)
      lesson.content_blocks.create!(block_type: :exercise, position: 0, body: "Submit your work", submission_type: nil)
    end
    assert_equal small, count_queries { SubmissionAudit.rows }
  end

  test "widening MWF leaves lesson calendar dates and progress untouched" do
    cohort = Cohort.create!(name: "Audit cohort", curriculum: @curriculum, start_date: Date.new(2026, 11, 2))
    [ 2, 4 ].each { |day| @module.lessons.create!(title: "Day #{day}", position: 0, release_day: day) }
    before = @module.lessons.map { |lesson| [ lesson.id, lesson.release_day, @module.start_date_for(cohort) + @module.calendar_offset_for(lesson.release_day) ] }
    @module.update!(schedule_days: "weekdays")
    after = @module.lessons.reload.map { |lesson| [ lesson.id, lesson.release_day, @module.start_date_for(cohort) + @module.calendar_offset_for(lesson.release_day) ] }
    assert_equal before, after
    assert_equal [ "Monday", "Wednesday", "Friday" ], @module.lessons.map { |lesson| @module.week_and_day_for(lesson.release_day)[:day_name] }
  end

  private

  def headers = { "Authorization" => "Bearer audit" }

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

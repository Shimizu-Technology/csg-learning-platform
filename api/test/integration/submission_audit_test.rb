require "test_helper"
require_relative "../support/query_counter"

class SubmissionAuditTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @admin = User.create!(clerk_id: "audit-admin", email: "audit-admin@example.invalid", role: :admin)
    @student = User.create!(clerk_id: "audit-student", email: "audit-student@example.invalid", role: :student)
    @curriculum = Curriculum.create!(name: "Audit lab", status: :active)
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
      assert_equal({ "error" => "This block changed. Reload the audit before reviewing it." }, response.parsed_body)
      assert OpenapiContract::DOCUMENT.dig("paths", "/api/v1/submission_audits/{id}", "patch", "responses", "409"), "stale-digest recovery must be documented"
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
      curriculum = Curriculum.create!(name: "Other #{index}", status: :active)
      mod = curriculum.modules.create!(name: "Other", position: 0)
      lesson = mod.lessons.create!(title: "Other", position: 0, release_day: 0)
      lesson.content_blocks.create!(block_type: :exercise, position: 0, body: "Submit your work", submission_type: nil)
      Cohort.create!(name: "Cohort #{index}", curriculum: curriculum, start_date: Date.current)
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

  test "instructional blocks offer no submission suggestion while work blocks do" do
    %w[text video recording].each_with_index do |kind, index|
      block = @lesson.content_blocks.create!(block_type: kind, position: index + 1, body: "Upload your file", submission_type: :manual_complete)
      row = SubmissionAudit.rows.find { |item| item[:id] == block.id }
      assert row
      assert_nil row[:suggested_type]
    end
    %w[exercise code_challenge checkpoint].each do |kind|
      @block.update!(block_type: kind)
      assert_equal "repo_and_live_url_submission", SubmissionAudit.rows.find { |row| row[:id] == @block.id }[:suggested_type]
    end
  end

  test "cohort github settings exclude fully configured work and expose mixed configurations" do
    @module.update!(module_type: :live_class)
    @block.update!(submission_type: nil, filename: "answer.rb")
    cohort = Cohort.create!(name: "Sync cohort", curriculum: @curriculum, start_date: Date.current,
      settings: { module_github_config: { @module.id.to_s => { requires_github: true } } })
    assert_empty SubmissionAudit.rows
    cohort.update!(settings: cohort.settings.deep_merge("features" => { "github_sync" => false }))
    assert_empty SubmissionAudit.rows, "sync off resolves to text submission, not manual completion"
    missing = Cohort.create!(name: "Manual cohort", curriculum: @curriculum, start_date: Date.current)
    row = SubmissionAudit.rows.sole
    assert_equal({ cohort.id => "text_submission", missing.id => "manual_complete" }, row[:cohort_submissions].to_h { |item| [ item[:id], item[:submission_type] ] })
    cohort.update!(settings: cohort.settings.deep_merge("features" => { "github_sync" => true }))
    row = SubmissionAudit.rows.sole
    assert_equal({ cohort.id => "prework_github_sync", missing.id => "manual_complete" }, row[:cohort_submissions].to_h { |item| [ item[:id], item[:submission_type] ] })
  end

  test "draft and archived curricula are excluded" do
    @curriculum.update!(status: :draft)
    assert_empty SubmissionAudit.rows
    @curriculum.update!(status: :archived)
    assert_empty SubmissionAudit.rows
  end

  test "deleting a reviewer retains the practice decision" do
    review = SubmissionAuditReview.create!(content_block: @block, reviewed_by: @admin, content_digest: SubmissionAudit.digest(@block))
    @admin.delete
    assert_nil review.reload.reviewed_by
    assert review.valid?
    assert_empty SubmissionAudit.rows
  end

  test "audit never creates school settings even inside a read-only transaction" do
    ActiveRecord::Base.transaction(requires_new: true) do
      ActiveRecord::Base.connection.execute("SET TRANSACTION READ ONLY")
      assert_equal [ @block.id ], SubmissionAudit.rows.map { |row| row[:id] }
    end
  end

  test "retrieval checkpoints are not submission audit candidates" do
    @block.update!(block_type: :checkpoint)
    @block.create_knowledge_check!(prompt: "Check", options: [ "A", "B" ], correct_option: 0, explanation: "A is correct")
    assert_empty SubmissionAudit.rows
    assert_nil SubmissionAudit.suggested_type(@block)
    as_user(@admin) do
      patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: SubmissionAudit.digest(@block) }, headers: headers, as: :json
      assert_response :unprocessable_entity
    end
  end

  test "type submission mode and lesson requirement changes invalidate a review digest" do
    digest = SubmissionAudit.digest(@block)
    @block.update!(block_type: :text)
    refute_equal digest, SubmissionAudit.digest(@block)
    digest = SubmissionAudit.digest(@block)
    @block.update!(submission_type: nil)
    refute_equal digest, SubmissionAudit.digest(@block)
    digest = SubmissionAudit.digest(@block)
    @lesson.update!(requires_submission: true)
    refute_equal digest, SubmissionAudit.digest(@block)
  end

  test "review rejects missing input noncandidates and nonexistent blocks and uses a non-key-update lock" do
    as_user(@admin) do
      patch "/api/v1/submission_audits/#{@block.id}", params: {}, headers: headers, as: :json
      assert_response :bad_request
      assert_equal "content_digest is required.", response.parsed_body["error"]
      @block.update!(submission_type: :text_submission)
      patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: SubmissionAudit.digest(@block) }, headers: headers, as: :json
      assert_response :unprocessable_entity
      assert_nil @block.reload.submission_audit_review
      patch "/api/v1/submission_audits/999999999", params: { content_digest: "missing" }, headers: headers, as: :json
      assert_response :not_found
      @block.update!(submission_type: :manual_complete)
      queries = capture_queries do
        patch "/api/v1/submission_audits/#{@block.id}", params: { content_digest: SubmissionAudit.digest(@block) }, headers: headers, as: :json
      end
      assert_response :success
      assert queries.any? { |sql| sql.include?("FOR NO KEY UPDATE") }
      refute queries.any? { |sql| sql.match?(/FOR UPDATE/) }
    end
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

require "test_helper"
require_relative "../support/query_counter"

# Based on the independent reviewer's zz_pr288_recheck_test.rb reproduction.
# Existing completion semantics are intentional here: confirmed new work reopens
# the lesson; confirmation must make that consequence explicit before any write.
class SubmissionAuditRecheckTest < ActionDispatch::IntegrationTest
  include QueryCounter
  setup do
    @admin = User.create!(clerk_id: "rc-admin", email: "rc-admin@example.invalid", role: :admin)
    @learner = User.create!(clerk_id: "rc-learner", email: "rc-learner@example.invalid", role: :student)
    @curriculum = Curriculum.create!(name: "Recheck", status: :active)
    @cohort = Cohort.create!(name: "Cohort 3", curriculum: @curriculum, start_date: Date.current - 14, status: :active)
    @module = @curriculum.modules.create!(name: "Web", position: 0, schedule_days: "mwf")
    @enrollment = Enrollment.create!(user: @learner, cohort: @cohort, status: :active, joined_at: 20.days.ago)
    @enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    @lesson = @module.lessons.create!(title: "Ship it", position: 0, release_day: 0)
    @text = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Deploy your site", body: "Deploy your site to Netlify.")
  end

  test "completed instruction-only lesson requires explicit companion confirmation without rewriting progress" do
    progress = Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    original = progress.attributes
    assert LearnerProgress.new(@enrollment.reload).lesson_progress(@lesson.reload).completed
    as_admin { get "/api/v1/lessons/#{@lesson.id}/block_editor", headers: headers }
    impact = response.parsed_body.fetch("completion_impact")
    assert_equal 1, impact["completed_learners"]
    assert_equal [ { "id" => @cohort.id, "name" => "Cohort 3", "completed_learners" => 1 } ], impact["cohorts"]
    audit = SubmissionAudit.rows.find { |row| row[:id] == @text.id }
    assert_nil audit[:suggested_type]
    assert_equal 1, audit[:completion_impact][:completed_learners]

    put_editor([ original_block, companion ])
    assert_response :unprocessable_entity
    assert_equal "confirm_reopen_completed", response.parsed_body["code"]
    assert_equal 1, response.parsed_body.dig("completion_impact", "completed_learners")
    assert_equal 1, @lesson.content_blocks.count
    assert LearnerProgress.new(@enrollment.reload).lesson_progress(@lesson.reload).completed
    assert_equal original, progress.reload.attributes

    put_editor([ original_block, companion ], confirm: 1)
    assert_response :success
    after = LearnerProgress.new(@enrollment.reload).lesson_progress(@lesson.reload)
    refute after.completed
    assert_equal [ 0, 1, "open" ], [ after.completed_blocks, after.total_blocks, after.status ]
    assert_equal original, progress.reload.attributes
  end

  test "completed lesson with an existing exercise is counted even if its instruction has no completion" do
    exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Current work", body: "Submit work", submission_type: :manual_complete)
    Progress.create!(user: @learner, enrollment: @enrollment, content_block: exercise, status: :completed)
    impact = LessonCompletionImpact.for_lessons([ @lesson ]).fetch(@lesson.id)
    assert_equal 1, impact[:completed_learners]
    blocks = [ original_block, { id: exercise.id, block_type: "exercise", submission_type: "manual_complete", body: exercise.body }, companion ]
    put_editor(blocks)
    assert_response :unprocessable_entity
    put_editor(blocks, confirm: 1)
    assert_response :success
    after = LearnerProgress.new(@enrollment.reload).lesson_progress(@lesson.reload)
    assert_equal [ 1, 2, false ], [ after.completed_blocks, after.total_blocks, after.completed ]
  end

  test "existing manual exercise may gain a submission without reopening recorded completion" do
    @text.update!(block_type: :exercise, submission_type: :manual_complete)
    progress = Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    original = progress.attributes
    put_editor([ original_block.merge(block_type: "exercise", submission_type: "text_submission") ])
    assert_response :success
    assert LearnerProgress.new(@enrollment.reload).lesson_progress(@lesson.reload).completed
    assert_equal original, progress.reload.attributes
  end

  test "no acknowledgement is needed when nobody completed the lesson" do
    put_editor([ original_block, companion ])
    assert_response :success
  end

  test "a changed affected count needs a fresh decision" do
    Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    put_editor([ original_block, companion ], confirm: 0)
    assert_response :unprocessable_entity
    assert_equal 1, @lesson.content_blocks.count
  end

  test "completion impact queries stay flat across curricula and learners" do
    Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    SubmissionAudit.rows
    small = count_queries { SubmissionAudit.rows }
    4.times do |i|
      curriculum = Curriculum.create!(name: "Impact #{i}", status: :active)
      mod = curriculum.modules.create!(name: "Impact", position: 0)
      lesson = mod.lessons.create!(title: "Impact", release_day: 0, position: 0)
      block = lesson.content_blocks.create!(block_type: :text, position: 0, body: "Upload your file")
      cohort = Cohort.create!(name: "Impact #{i}", curriculum: curriculum, start_date: Date.current - 7)
      person = User.create!(clerk_id: "impact-#{i}", email: "impact-#{i}@example.invalid", role: :student)
      enrollment = Enrollment.create!(user: person, cohort: cohort)
      enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
      Progress.create!(user: person, enrollment: enrollment, content_block: block, status: :completed)
    end
    assert_equal small, count_queries { SubmissionAudit.rows }
    assert_equal 5, SubmissionAudit.rows.sum { |row| row[:completion_impact][:completed_learners] }
  end

  test "lesson impact counts a learner once and reports each completed cohort" do
    Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    other = Cohort.create!(name: "Cohort 4", curriculum: @curriculum, start_date: Date.current - 7)
    enrollment = Enrollment.create!(user: @learner, cohort: other)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    Progress.create!(user: @learner, enrollment: enrollment, content_block: @text, status: :completed)
    impact = LessonCompletionImpact.for_lessons([ @lesson ]).fetch(@lesson.id)
    assert_equal 1, impact[:completed_learners]
    assert_equal [ @cohort.id, other.id ].sort, impact[:cohorts].map { |row| row[:id] }.sort
    assert_equal [ 1, 1 ], impact[:cohorts].map { |row| row[:completed_learners] }
  end

  test "past access does not hide recorded completed learners from the warning" do
    Progress.create!(user: @learner, enrollment: @enrollment, content_block: @text, status: :completed)
    @enrollment.update_columns(access_expires_at: 1.day.ago)
    assert_equal 1, LessonCompletionImpact.for_lessons([ @lesson ]).fetch(@lesson.id)[:completed_learners]
  end

  private

  def original_block = { id: @text.id, block_type: @text.block_type, title: @text.title, body: @text.body }
  def companion = { client_id: "companion", block_type: "exercise", title: "Exercise: Deploy your site", body: @text.body, submission_type: "text_submission" }

  def put_editor(blocks, confirm: nil)
    body = { base_updated_at: @lesson.reload.updated_at.iso8601(6), title: @lesson.title, required: true, blocks: blocks }
    body[:confirm_reopen_completed_count] = confirm unless confirm.nil?
    as_admin { put "/api/v1/lessons/#{@lesson.id}/block_editor", params: { lesson: body }, headers: headers, as: :json }
  end

  def headers = { "Authorization" => "Bearer rc" }
  def as_admin
    original = ClerkAuth.method(:verify)
    user = @admin
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end

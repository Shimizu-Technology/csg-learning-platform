require "test_helper"
require "stringio"
require "tempfile"
require "rake"
require_relative "../../../lib/ops/apply_submission_audit_20261118"

class ApplySubmissionAudit20261118Test < ActiveSupport::TestCase
  setup do
    @admin = User.create!(clerk_id: "ops-admin", email: "ops-admin@example.invalid", role: :admin)
    @curriculum = Curriculum.create!(name: "Bootcamp", status: :active)
    @module = @curriculum.modules.create!(name: "Web", position: 0)
    @blocks = {}
    klass = Ops::ApplySubmissionAudit20261118
    (klass::PRACTICE + klass::TYPES.keys + klass::COMPANIONS.keys).each_with_index do |id, index|
      lesson = @module.lessons.create!(title: "Lesson #{id}", position: index, release_day: 0)
      @blocks[id] = lesson.content_blocks.create!(id: id, block_type: klass::TYPES.key?(id) ? :exercise : :text,
        position: 0, title: "Deploy assignment #{id}", body: "Submit your work to GitHub", submission_type: :manual_complete)
    end
    library = Curriculum.create!(name: klass::LIBRARY, status: :active)
    mod = library.modules.create!(name: "Library", position: 0)
    82.times do |i|
      lesson = mod.lessons.create!(title: "Library #{i}", position: i, release_day: 0)
      block = lesson.content_blocks.create!(id: 2000 + i, block_type: :text, position: 0, title: "Deploy example #{i}")
      @blocks[block.id] = block
    end
    @baseline = { "audit_commit" => "d68e0b3", "blocks" => @blocks.values.map do |block|
      { "id" => block.id, "content_digest" => SubmissionAudit.digest(block), "lesson_id" => block.lesson_id,
        "curriculum_id" => block.lesson.curriculum_module.curriculum_id,
        "curriculum_name" => block.lesson.curriculum_module.curriculum.name }
    end }
    ActiveRecord::Base.connection.reset_pk_sequence!("content_blocks")
    @output = StringIO.new
  end

  test "default dry run writes nothing and describes every decision and impact" do
    before = snapshot
    result = run_task
    assert_equal 99, result[:counts]["dry_run"]
    assert_equal before, snapshot
    row = result[:blocks].find { |item| item[:id] == 700 }
    assert_equal "repo_url_submission", row[:target]
    assert_equal 0, row.dig(:completion_impact, :completed_learners)
    assert @output.string.include?("Summary:")
    assert_equal result[:counts].stringify_keys, JSON.parse(@output.string.lines.last)["counts"]
  end

  test "apply all decisions and rerun changes nothing" do
    result = run_task(apply: true)
    assert_equal 99, result[:counts]["applied"]
    assert_equal 91, SubmissionAuditReview.count
    assert SubmissionAuditReview.all.all? { |review| review.reviewed_by_id == @admin.id && review.content_digest == SubmissionAudit.digest(review.content_block) }
    assert_equal "repo_url_submission", @blocks[57].reload.submission_type
    Ops::ApplySubmissionAudit20261118::COMPANIONS.each do |id, type|
      source = @blocks.fetch(id).reload
      companion = source.lesson.content_blocks.order(:position).last
      assert_equal "Exercise: #{source.title}", companion.title
      assert_equal type, companion.submission_type
      assert_equal source.position + 1, companion.position
    end
    before = snapshot
    assert_equal 99, run_task(apply: true)[:counts]["already_applied"]
    assert_equal before, snapshot
  end

  test "content drift refuses that lesson while other lessons proceed" do
    @blocks[700].update!(body: "Different instructions: submit your repo")
    result = run_task(apply: true)
    assert_equal 1, result[:counts]["refused"]
    assert_equal "manual_complete", @blocks[700].reload.submission_type
  end

  test "completed lesson refuses companion and preserves progress" do
    learner = User.create!(clerk_id: "ops-learner", email: "ops-learner@example.invalid", role: :student)
    cohort = Cohort.create!(name: "Cohort 3", curriculum: @curriculum, start_date: Date.current - 14)
    enrollment = Enrollment.create!(user: learner, cohort: cohort, joined_at: 20.days.ago)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    source = @blocks[356]
    Progress.create!(user: learner, enrollment: enrollment, content_block: source, status: :completed)
    result = run_task(apply: true)
    row = result[:blocks].find { |item| item[:id] == 356 }
    assert_equal "refused", row[:status]
    assert_equal 1, row.dig(:completion_impact, :completed_learners)
    assert_equal "Cohort 3", row.dig(:completion_impact, :cohorts, 0, :name)
    assert_equal 1, source.lesson.content_blocks.count
    assert_equal 1, Progress.completed.count
  end

  test "type change preserves completed learners and their progress" do
    learner = User.create!(clerk_id: "ops-completer", email: "ops-completer@example.invalid", role: :student)
    cohort = Cohort.create!(name: "Cohort 3", curriculum: @curriculum, start_date: Date.current - 14)
    enrollment = Enrollment.create!(user: learner, cohort: cohort, joined_at: 20.days.ago)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    block = @blocks[57]
    progress = Progress.create!(user: learner, enrollment: enrollment, content_block: block, status: :completed)
    before = progress.attributes
    result = run_task(apply: true)
    assert_equal 99, result[:counts]["applied"]
    assert_equal "repo_url_submission", block.reload.submission_type
    assert_equal before, progress.reload.attributes
    assert LearnerProgress.new(enrollment.reload).lesson_progress(block.lesson.reload).completed
  end

  test "conflicting submission refuses type change" do
    learner = User.create!(clerk_id: "ops-submitter", email: "ops-submitter@example.invalid", role: :student)
    cohort = Cohort.create!(name: "Cohort 3", curriculum: @curriculum, start_date: Date.current - 14)
    enrollment = Enrollment.create!(user: learner, cohort: cohort)
    Submission.create!(user: learner, enrollment: enrollment, content_block: @blocks[57], submission_type: :text_submission, text: "Existing answer")
    assert_equal 1, run_task(apply: true)[:counts]["refused"]
    assert_equal "manual_complete", @blocks[57].reload.submission_type
  end

  test "missing baseline and moved block refuse rather than guess" do
    @baseline["blocks"].reject! { |row| row["id"] == 700 }
    @baseline["blocks"].find { |row| row["id"] == 57 }["lesson_id"] = -1
    assert_equal 2, run_task(apply: true)[:counts]["refused"]
  end

  test "extra library candidate fails closed" do
    block = @blocks[2000]
    block.lesson.content_blocks.create!(block_type: :text, position: 1, title: "Upload your work")
    assert_equal 1, run_task(apply: true)[:counts]["refused"]
    assert_equal 0, SubmissionAuditReview.count
  end

  test "decisions sharing a lesson are atomic and rerun without timestamp changes" do
    target = @blocks[356].lesson
    @blocks[358].update!(lesson: target, position: 1)
    @blocks[181].update!(lesson: target, position: 2)
    @baseline["blocks"].each do |row|
      block = @blocks.fetch(row["id"])
      row["lesson_id"] = block.lesson_id
      row["content_digest"] = SubmissionAudit.digest(block.reload)
    end
    assert_equal 99, run_task(apply: true)[:counts]["applied"]
    before = snapshot
    assert_equal 99, run_task(apply: true)[:counts]["already_applied"]
    assert_equal before, snapshot
  end

  test "a refused decision rolls back the other decisions in its lesson" do
    @blocks[358].update!(lesson: @blocks[356].lesson, position: 1)
    @baseline["blocks"].find { |row| row["id"] == 358 }["lesson_id"] = @blocks[356].lesson_id
    @blocks[358].update!(body: "Changed: submit your work")
    result = run_task(apply: true)
    assert_equal 2, result[:counts]["refused"]
    assert_equal 2, @blocks[356].lesson.content_blocks.count
  end

  test "changed companion refuses rerun" do
    run_task(apply: true)
    companion = @blocks[356].lesson.content_blocks.order(:position).last
    companion.update!(body: "Different requirements")
    before = snapshot
    assert_equal 1, run_task(apply: true)[:counts]["refused"]
    assert_equal before, snapshot
  end

  test "rake defaults to dry run and DRY_RUN overrides APPLY" do
    before = snapshot
    invoke_rake({ "APPLY" => nil, "DRY_RUN" => nil })
    assert_equal before, snapshot
    invoke_rake({ "APPLY" => "1", "DRY_RUN" => "1" })
    assert_equal before, snapshot
  end

  test "rake requires APPLY to write" do
    invoke_rake({ "APPLY" => "1", "DRY_RUN" => nil })
    assert_equal 91, SubmissionAuditReview.count
  end

  private

  def run_task(apply: false)
    Ops::ApplySubmissionAudit20261118.new(admin: @admin, baseline: @baseline, apply: apply, output: @output).run
  end

  def invoke_rake(flags)
    Rails.application.load_tasks unless Rake::Task.task_defined?("ops:apply_submission_audit_20261118")
    Tempfile.create([ "audit-baseline", ".json" ]) do |file|
      file.write(JSON.generate(@baseline))
      file.flush
      env = flags.merge("ADMIN_USER_ID" => @admin.id.to_s, "AUDIT_BASELINE" => file.path)
      original = ENV.to_h.slice(*env.keys)
      begin
        env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
        Rake::Task["ops:apply_submission_audit_20261118"].reenable
        capture_io { Rake::Task["ops:apply_submission_audit_20261118"].invoke }
      ensure
        env.each_key { |key| original.key?(key) ? ENV[key] = original[key] : ENV.delete(key) }
      end
    end
  end

  def snapshot
    [ ContentBlock.order(:id).map(&:attributes), Lesson.order(:id).map(&:attributes), SubmissionAuditReview.order(:id).map(&:attributes) ]
  end
end

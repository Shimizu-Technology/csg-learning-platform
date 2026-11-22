require "test_helper"
require "stringio"
require "tempfile"
require "rake"
require_relative "../../../lib/ops/apply_submission_audit_20261118"
require_relative "../../../lib/ops/submission_audit_baseline_20261118"

class ApplySubmissionAudit20261118Test < ActiveSupport::TestCase
  # Keep the dormant companion path exercised without enabling it for this run.
  class CompanionScenario < Ops::ApplySubmissionAudit20261118
    COMPANION_FIXTURES = { 356 => "repo_and_live_url_submission", 358 => "repo_and_live_url_submission",
      1088 => "repo_url_submission", 1099 => "repo_url_submission", 1093 => "text_submission",
      1101 => "repo_and_live_url_submission" }.freeze

    private

    def decision_plan
      super.merge(COMPANION_FIXTURES.transform_values { |type| [ "companion", type ] })
    end
  end

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
    @cutoff = 1.hour.from_now
    @baseline = { "source" => "production_export", "cutoff" => @cutoff.iso8601(6), "blocks" => @blocks.values.map do |block|
      { "id" => block.id, "content_digest" => SubmissionAudit.digest(block), "lesson_id" => block.lesson_id,
        "curriculum_id" => block.lesson.curriculum_module.curriculum_id,
        "curriculum_name" => block.lesson.curriculum_module.curriculum.name, "block_updated_at" => block.updated_at.iso8601(6), "lesson_updated_at" => block.lesson.updated_at.iso8601(6) }
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
    assert_equal 97, SubmissionAuditReview.count
    assert SubmissionAuditReview.all.all? { |review| review.reviewed_by_id == @admin.id && review.content_digest == SubmissionAudit.digest(review.content_block) }
    assert_equal "repo_url_submission", @blocks[57].reload.submission_type
    CompanionScenario::COMPANION_FIXTURES.each do |id, type|
      source = @blocks.fetch(id).reload
      companion = source.lesson.content_blocks.order(:position).last
      assert_equal "Exercise: #{source.title}", companion.title
      assert_equal type, companion.submission_type
      assert_equal source.position + 1, companion.position
      refute_includes SubmissionAudit.blocks.map(&:id), source.id
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
    assert_equal 97, SubmissionAuditReview.count
  end

  [ 181, 57, 356, 681 ].each do |id|
    test "library overlap with fixed decision #{id} refuses the whole run" do
      row = @baseline["blocks"].find { |item| item["id"] == id }
      if row
        row["curriculum_name"] = Ops::ApplySubmissionAudit20261118::LIBRARY
      else
        @baseline["blocks"] << @baseline["blocks"].last.merge("id" => id)
      end
      before = snapshot
      result = run_task(apply: true)
      assert_equal 1, result[:counts]["refused"]
      assert_includes result[:blocks].first[:reason], "overlap"
      assert_equal before, snapshot
    end
  end

  [ 356, 57 ].each do |id|
    test "decision #{id} refuses an unapproved implicit-type sibling in dry run and apply" do
      source = @blocks.fetch(id)
      sibling = source.lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Unapproved sibling")
      before = snapshot
      [ false, true ].each do |apply|
        result = run_task(apply: apply)
        row = result[:blocks].find { |item| item[:id] == id }
        assert_equal "refused", row[:status]
        assert_includes row[:reason], "unapproved sibling"
        assert_equal({ before: false, after: true }, row[:lesson_impact][:requires_submission])
        impact = row[:lesson_impact][:sibling_changes].find { |change| change[:id] == sibling.id }
        assert_equal "manual_complete", impact[:before][:effective_types][:default]
        assert_equal "text_submission", impact[:after][:effective_types][:default]
        refute_equal impact[:before][:content_digest], impact[:after][:content_digest]
      end
      # Other lessons may apply, but this lesson and its blocks stay unchanged.
      assert_equal before[0].select { |block| block["lesson_id"] == source.lesson_id }, snapshot[0].select { |block| block["lesson_id"] == source.lesson_id }
      assert_equal false, source.lesson.reload.requires_submission
    end
  end

  test "harmless sibling digest changes are reported and its HTML stays byte-identical" do
    source = @blocks[356]
    sibling = source.lesson.content_blocks.create!(block_type: :text, position: 1, title: "Reading", body: "<p>A &amp; B<br>exact markup</p>")
    html = sibling.body
    dry = run_task[:blocks].find { |row| row[:id] == source.id }
    impact = dry[:lesson_impact][:sibling_changes].find { |change| change[:id] == sibling.id }
    assert_equal impact[:before][:effective_types], impact[:after][:effective_types]
    refute_equal impact[:before][:content_digest], impact[:after][:content_digest]
    assert_equal "dry_run", dry[:status]
    assert_equal 99, run_task(apply: true)[:counts]["applied"]
    assert source.lesson.reload.requires_submission
    assert_equal html, sibling.reload.body
    assert_equal impact[:after][:content_digest], SubmissionAudit.digest(sibling)
  end

  test "companion preview copies source body, falls back for blank title, and reviews the source" do
    block = @blocks[356]
    block.update!(title: "", body: "<p>Deploy the API and hand in its repository and deployed URLs.</p>")
    row = @baseline["blocks"].find { |item| item["id"] == block.id }
    row["content_digest"] = SubmissionAudit.digest(block)
    preview = run_task[:blocks].find { |item| item[:id] == block.id }[:companion]
    assert_equal "Exercise: Your work", preview[:title]
    assert_equal block.body, preview[:body]
    assert_equal 99, run_task(apply: true)[:counts]["applied"]
    assert_equal block.body, block.lesson.content_blocks.order(:position).last.body
    assert_equal SubmissionAudit.digest(block.reload), block.submission_audit_review.reload.content_digest
    refute_includes SubmissionAudit.blocks.map(&:id), block.id
  end

  test "an existing work block cannot receive a companion" do
    block = @blocks[356]
    block.update!(block_type: :exercise)
    @baseline["blocks"].find { |item| item["id"] == block.id }["content_digest"] = SubmissionAudit.digest(block)
    row = run_task(apply: true)[:blocks].find { |item| item[:id] == block.id }
    assert_equal "refused", row[:status]
    assert_includes row[:reason], "already a work block"
    assert_equal 1, block.lesson.content_blocks.count
  end

  test "moved companion is found globally and rerun refuses without duplicating work" do
    run_task(apply: true)
    source = @blocks[356]
    companion = source.lesson.content_blocks.order(:position).last
    companion.update!(lesson: @blocks[181].lesson, position: 1)
    before = snapshot
    row = run_task(apply: true)[:blocks].find { |item| item[:id] == source.id }
    assert_equal "refused", row[:status]
    assert_includes row[:reason], "moved to another lesson"
    assert_equal before, snapshot
  end

  test "post-cutoff block or lesson timestamp refuses even when the digest is unchanged" do
    @blocks[57].update_column(:updated_at, @cutoff + 1.second)
    @blocks[700].lesson.update_column(:updated_at, @cutoff + 1.second)
    result = run_task(apply: true)
    assert_equal 2, result[:counts]["refused"]
    [ 57, 700 ].each do |id|
      row = result[:blocks].find { |item| item[:id] == id }
      assert_includes row[:reason], "updated after cutoff"
      assert_equal "manual_complete", @blocks[id].reload.submission_type
    end
  end

  test "post-cutoff timestamps in baseline refuse a tampered export" do
    @baseline["blocks"].find { |row| row["id"] == 57 }["block_updated_at"] = (@cutoff + 1.second).iso8601(6)
    assert_equal 1, run_task(apply: true)[:counts]["refused"]
  end

  test "pending Clerk admin is rejected" do
    @admin.update_column(:clerk_id, "pending_admin")
    assert_raises(Ops::ApplySubmissionAudit20261118::Refused) { run_task(apply: true) }
  end

  [ ActiveRecord::StatementInvalid, ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionTimeoutError ].each do |error_class|
    test "#{error_class} produces a per-lesson refusal and final report" do
      failing_id = @blocks[57].lesson_id
      original = LessonBlockEditor.instance_method(:save!)
      LessonBlockEditor.define_method(:save!) do
        raise error_class, "Synthetic database failure" if @lesson.id == failing_id
        original.bind_call(self)
      end
      begin
        result = run_task(apply: true)
        assert_equal 1, result[:counts]["refused"]
        assert_equal 98, result[:counts]["applied"]
        assert_equal "manual_complete", @blocks[57].reload.submission_type
        assert_equal result[:counts], JSON.parse(@output.string.lines.last)["counts"]
      ensure
        LessonBlockEditor.define_method(:save!, original)
      end
    end
  end

  test "practice-only lessons take no learner-exclusive block locks" do
    queries = []
    subscriber = ->(*, payload) { queries << payload if payload[:sql].include?('"content_blocks"') && payload[:sql].include?("FOR ") }
    ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") { run_task(apply: true) }
    practice_queries = queries.select { |payload| payload[:binds].any? { |bind| bind.value_for_database == 2000 } || payload[:sql].match?(/\b2000\b/) }
    assert practice_queries.any? { |payload| payload[:sql].include?("FOR NO KEY UPDATE") }
    refute practice_queries.any? { |payload| payload[:sql].match?(/FOR UPDATE\b/) }
  end

  test "baseline exporter includes reviewed library rows and writes no records" do
    block = @blocks[2000]
    block.create_submission_audit_review!(content_digest: SubmissionAudit.digest(block), reviewed_by: @admin)
    before = snapshot
    export = export_baseline
    assert_equal "production_export", export[:source]
    assert_equal 99, export[:blocks].size
    assert_equal (2000..2081).to_a, export[:library_ids]
    assert export[:blocks].any? { |row| row[:id] == block.id }
    assert export[:blocks].all? { |row| row[:block_updated_at].present? && row[:lesson_updated_at].present? }
    assert_equal before, snapshot
  end

  test "baseline exporter lists all block and lesson timestamp offenders" do
    @blocks[57].update_column(:updated_at, @cutoff + 1.second)
    @blocks[700].lesson.update_column(:updated_at, @cutoff + 2.seconds)
    before = snapshot
    result = export_baseline
    assert result[:refused]
    assert_nil result[:source]
    assert_equal [ 57, 700 ], result[:offenders].map { |row| row[:id] }.sort
    assert_includes result[:offenders].first[:reason], "cutoff"
    assert_equal before, snapshot
  end

  test "baseline exporter refuses a fixed decision selected through the library" do
    @blocks[57].update!(lesson: @blocks[2000].lesson, position: 1)
    before = snapshot
    export = export_baseline
    assert export[:refused]
    assert export[:offenders].any? { |row| row[:reason].include?("overlap") && row[:ids].include?(57) }
    assert_equal before, snapshot
  end

  test "apply rejects an old commit claim and mismatched printed library ids" do
    baseline = @baseline.dup
    baseline.delete("source")
    baseline["audit_commit"] = "d68e0b3"
    assert_raises(Ops::ApplySubmissionAudit20261118::Refused) do
      Ops::ApplySubmissionAudit20261118.new(admin: @admin, baseline: baseline, output: @output).run
    end
    @baseline["library_ids"] = (2000..2080).to_a + [ 9999 ]
    assert_equal 1, run_task(apply: true)[:counts]["refused"]
    assert_equal 0, SubmissionAuditReview.count
  end

  test "baseline exporter refuses wrong library count" do
    @blocks[2000].update!(title: "Read this", body: "No hand-in requested")
    result = export_baseline
    assert result[:refused]
    assert result[:offenders].any? { |row| row[:reason].include?("exactly 82") }
  end

  test "baseline export can be consumed directly and rerun after the cutoff" do
    export = export_baseline
    @baseline = JSON.parse(JSON.generate(export))
    travel_to(@cutoff + 1.day) do
      assert_equal 99, run_task(apply: true)[:counts]["applied"]
      before = snapshot
      assert_equal 99, run_task(apply: true)[:counts]["already_applied"]
      assert_equal before, snapshot
    end
  end

  test "current decisions review all six former companions without adding work" do
    before = ContentBlock.count
    baseline = Marshal.load(Marshal.dump(@baseline))
    result = run_task(apply: true, runner_class: Ops::ApplySubmissionAudit20261118)
    assert_equal 99, result[:counts]["applied"]
    assert_equal before, ContentBlock.count
    assert_empty Ops::ApplySubmissionAudit20261118::COMPANIONS
    CompanionScenario::COMPANION_FIXTURES.each_key do |id|
      row = result[:blocks].find { |item| item[:id] == id }
      assert_equal "practice", row[:action]
      assert_empty row[:lesson_impact][:sibling_changes]
      assert @blocks[id].reload.submission_audit_review
    end
    assert_equal baseline, @baseline
    assert_equal @baseline["blocks"].map { |row| row["id"] }.sort, export_baseline[:blocks].map { |row| row[:id] }.sort
  end

  test "practice reviews with implicit legacy siblings preserve lesson and sibling behavior" do
    [ 1079, 356 ].each do |id|
      block = @blocks[id]
      block.lesson.update!(requires_submission: true)
      sibling = block.lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Real submission", submission_type: nil)
      row = @baseline["blocks"].find { |item| item["id"] == id }
      row["content_digest"] = SubmissionAudit.digest(block)
      row["lesson_updated_at"] = block.lesson.updated_at.iso8601(6)
      assert_equal "text_submission", sibling.effective_submission_type
    end
    lesson_ids = [ @blocks[1079].lesson_id, @blocks[356].lesson_id ]
    original_blocks = ContentBlock.where(lesson_id: lesson_ids).order(:id).map(&:attributes)
    original_lessons = Lesson.where(id: lesson_ids).order(:id).map(&:attributes)
    dry = run_task(runner_class: Ops::ApplySubmissionAudit20261118)
    assert_equal 99, dry[:counts]["dry_run"]
    result = run_task(apply: true, runner_class: Ops::ApplySubmissionAudit20261118)
    assert_equal 99, result[:counts]["applied"]
    [ 1079, 356 ].each do |id|
      row = result[:blocks].find { |item| item[:id] == id }
      assert_equal({ before: true, after: true }, row[:lesson_impact][:requires_submission])
      assert_empty row[:lesson_impact][:sibling_changes]
      assert_equal "text_submission", @blocks[id].lesson.content_blocks.order(:position).last.effective_submission_type
    end
    assert_equal original_blocks, ContentBlock.where(lesson_id: lesson_ids).order(:id).map(&:attributes)
    assert_equal original_lessons, Lesson.where(id: lesson_ids).order(:id).map(&:attributes)
    before = snapshot
    assert_equal 99, run_task(apply: true, runner_class: Ops::ApplySubmissionAudit20261118)[:counts]["already_applied"]
    assert_equal before, snapshot
  end

  [ 57, 700 ].each do |id|
    test "current type decision #{id} reports no sibling changes in its fixture lesson" do
      row = run_task(runner_class: Ops::ApplySubmissionAudit20261118)[:blocks].find { |item| item[:id] == id }
      assert_equal "dry_run", row[:status]
      assert_empty row[:lesson_impact][:sibling_changes]
    end

    test "current type decision #{id} refuses an implicit sibling when its flag would change" do
      block = @blocks[id]
      sibling = block.lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Implicit work")
      [ false, true ].each do |apply|
        row = run_task(apply: apply, runner_class: Ops::ApplySubmissionAudit20261118)[:blocks].find { |item| item[:id] == id }
        assert_equal "refused", row[:status]
        assert_includes row[:reason], "unapproved sibling"
      end
      assert_equal "manual_complete", sibling.reload.effective_submission_type
      assert_equal "manual_complete", block.reload.submission_type
    end
  end

  test "content projection preserves existing explicit submission enums with a true legacy flag" do
    block = @blocks[57]
    block.lesson.update!(requires_submission: true)
    sibling = block.lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Existing deployment",
      submission_type: :repo_and_live_url_submission)
    baseline = @baseline["blocks"].find { |row| row["id"] == block.id }
    baseline["content_digest"] = SubmissionAudit.digest(block)
    baseline["lesson_updated_at"] = block.lesson.updated_at.iso8601(6)
    row = run_task(runner_class: Ops::ApplySubmissionAudit20261118)[:blocks].find { |item| item[:id] == block.id }
    assert_equal "dry_run", row[:status]
    assert_equal({ before: true, after: true }, row[:lesson_impact][:requires_submission])
    assert_empty row[:lesson_impact][:sibling_changes]
    assert_equal "repo_and_live_url_submission", sibling.effective_submission_type
    assert_equal 99, run_task(apply: true, runner_class: Ops::ApplySubmissionAudit20261118)[:counts]["applied"]
    assert_equal "repo_and_live_url_submission", sibling.reload.effective_submission_type
  end

  test "normal editor save preserves a true legacy flag and implicit sibling when primary is manual" do
    lesson = @blocks[1079].lesson
    primary = @blocks[1079]
    primary.update!(block_type: :exercise)
    lesson.update!(requires_submission: true)
    sibling = lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Legacy submission")
    assert_equal "text_submission", sibling.effective_submission_type
    LessonBlockEditor.new(lesson: lesson, user: @admin, params: { base_updated_at: lesson.updated_at.iso8601(6),
      blocks: lesson.content_blocks.map { |block| { id: block.id, block_type: block.block_type } } }).save!
    assert lesson.reload.requires_submission
    assert_equal "text_submission", sibling.reload.effective_submission_type
  end

  private

  def export_baseline
    Ops::SubmissionAuditBaseline20261118.new(cutoff: @cutoff.iso8601(6), output: @output, diagnostics: StringIO.new).run
  end

  def run_task(apply: false, runner_class: CompanionScenario)
    runner_class.new(admin: @admin, baseline: @baseline, apply: apply, output: @output).run
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

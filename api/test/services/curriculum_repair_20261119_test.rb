require "test_helper"
require "stringio"
require "tempfile"

class CurriculumRepair20261119Test < ActiveSupport::TestCase
  setup do
    @curriculum = Curriculum.create!(id: 1, name: "CSG Full-Stack Bootcamp 2026", status: :active)
    @mod = @curriculum.modules.create!(id: 2, name: "Live Class", position: 1, schedule_days: "weekdays")
    User.create!(id: 1, clerk_id: "repair_admin", email: "repair-admin@example.invalid", first_name: "Test", last_name: "Admin", role: :admin)
    student = User.create!(id: 7, clerk_id: "repair_student", email: "repair-student@example.invalid", first_name: "Test", last_name: "Student")
    cohort = Cohort.create!(curriculum: @curriculum, name: "Repair test", start_date: Date.current - 180, status: :active)
    @enrollment = Enrollment.create!(id: 3, user: student, cohort: cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    ids = [ 2, 3, 4, 129, 131, 132, 136 ] + (143..237).to_a - [ 197 ]
    ids.each do |id|
      title = [ 232, 235 ].include?(id) ? "Optional: extension #{id}" : "Lesson #{id} for your organizer"
      lesson = @mod.lessons.create!(id: id, title: title, position: 1, release_day: id == 131 ? 0 : 70, lesson_type: :exercise)
      lesson.content_blocks.create!(block_type: :exercise, position: 1, body: "<p>Build in organizer_api. Actualize practice.</p>", submission_type: :manual_complete)
    end
    @mod.lessons.create!(id: 238, title: "Optional Additional Resources", position: 2, release_day: 70)
    @mod.lessons.create!(id: 239, title: "Submit your work", position: 3, release_day: 70)
    ContentBlock.create!(lesson_id: 4, block_type: :video, position: 0, video_url: "https://vimeo.com/841396051/bffa0be03b")
    ContentBlock.create!(lesson_id: 132, block_type: :video, position: 0, video_url: "https://youtu.be/lMnW4KklcUs", metadata: { video_segments: [ { "start_seconds" => 0, "end_seconds" => 2656, "required" => true, "label" => "Ruby review" } ] })
    ContentBlock.create!(lesson_id: 221, block_type: :video, position: 0, video_url: "https://youtu.be/3SW_W7PmEd4", metadata: { video_segments: [ { "start_seconds" => 1440, "end_seconds" => 2644, "required" => true, "label" => "Axios" }, { "start_seconds" => 5341, "end_seconds" => 7411, "required" => true, "label" => "State" } ] })
    @block = Lesson.find(213).primary_assignment_block
    @progress = Progress.create!(content_block: @block, user: student, enrollment: @enrollment, status: :completed)
    @submission = Submission.create!(content_block: Lesson.find(203).primary_assignment_block, user: student, enrollment: @enrollment, text: "Original work", grade: :B, feedback: "Keep this feedback", graded_by_id: 1)
    @plan = LearningPlan.create!(enrollment: @enrollment, title: "Existing plan", target_date: Date.new(2026, 12, 19), next_check_in_on: Date.new(2026, 11, 21),
      milestones: [ { "title" => "React setup", "due_on" => "2026-11-21", "lesson_ids" => [ 213, 218, 219 ] } ],
      lesson_overrides: [ { "lesson_id" => 214, "required" => false, "reason" => "Preserve exception" } ])
    @plan.revisions.create!(author_id: 1, snapshot: @plan.snapshot)
    [ Curriculum, CurriculumModule, Lesson, User, Enrollment ].each { |model| model.connection.reset_pk_sequence!(model.table_name) }
    @output = StringIO.new
  end

  test "dry run is read only and describes live fields and complete draft structure" do
    before = CurriculumRepair20261119.snapshot.fetch("tables")
    CurriculumRepair20261119.new(output: @output).run
    assert_equal before, CurriculumRepair20261119.snapshot.fetch("tables")
    diff = JSON.parse(@output.string)
    assert_equal "dry_run_plan", diff["mode"]
    assert_equal "draft", diff.dig("copy", "status")
    assert diff["shared_changes"].any? { |row| row["model"] == "Lesson" && row["id"] == -1 }
    assert_nil Curriculum.find_by(course_package_key: CurriculumRepair20261119::COPY_KEY)
  end

  test "apply preserves evidence and plan dates, fixes copy order, and a second run makes no changes" do
    progress_before = @progress.attributes
    submission_before = @submission.attributes
    plan_before = @plan.attributes
    live_video_before = ContentBlock.where(lesson_id: 221, block_type: :video).sole.metadata
    snapshot_file do |path|
      copy = CurriculumRepair20261119.new(output: @output).run(apply: true, snapshot_path: path)
      assert_equal progress_before, @progress.reload.attributes
      assert_equal submission_before, @submission.reload.attributes
      assert_equal plan_before.except("milestones", "updated_at", "lock_version"), @plan.reload.attributes.except("milestones", "updated_at", "lock_version")
      assert_equal 2, @plan.revisions.count
      git = Lesson.find(@plan.milestones.sole["lesson_ids"].first)
      assert_equal "Git branches and pull requests", git.title
      assert git.required?
      assert @enrollment.reload.lesson_required?(git)
      assert_equal "done", LearnerProgress.new(@enrollment).lesson_progress(Lesson.find(213)).status
      assert_equal "repo_url_submission", @block.reload.submission_type
      [ 129, 131, 213, 218, 221, 222, 223, 224, 225, 226, 228 ].each do |id|
        assert_match(/\A<(?:p|div|h[1-6])(?:\s|>)/, Lesson.find(id).primary_assignment_block.body)
      end
      assert_equal "markdown", git.primary_assignment_block.metadata.fetch("language")
      assert_includes Lesson.find(221).primary_assignment_block.body, "Body → Form → URL-encoded"
      assert_includes Lesson.find(205).primary_assignment_block.body, "Never put passwords, tokens or other secrets in Params"
      assert_includes Lesson.find(129).primary_assignment_block.body, "wsl --list --quiet"
      assert_equal "repo_and_live_url_submission", Lesson.find(230).primary_assignment_block.submission_type
      assert_nil ContentBlock.where(lesson_id: 4, block_type: :video).sole.video_url
      assert copy.draft?
      assert_empty copy.cohorts
      mapping = JSON.parse(copy.course_package_content_snapshot).fetch("lesson_ids")
      mapped = ->(id) { Lesson.find(mapping.fetch(id.to_s)) }
      assert mapped.call(208).release_day < mapped.call(203).release_day
      assert_equal 49, mapped.call(208).release_day
      assert_equal 50, mapped.call(203).release_day
      assert_includes mapped.call(185).primary_assignment_block.body, "rename available to checked_out"
      assert_includes mapped.call(186).primary_assignment_block.body, "unique ISBN"
      assert_includes mapped.call(143).primary_assignment_block.body, "For now"
      assert mapped.call(228).release_day < mapped.call(229).release_day
      assert mapped.call(229).release_day < mapped.call(221).release_day
      assert mapped.call(221).release_day < mapped.call(223).release_day
      assert_not mapped.call(232).required?
      assert_not mapped.call(235).required?
      assert_equal "Log In with a Rails Session", mapped.call(205).title
      assert_includes mapped.call(231).primary_assignment_block.body, "/api/* https://YOUR-API.onrender.com/api/:splat 200"
      assert_includes mapped.call(231).primary_assignment_block.body, "/* /index.html 200"
      [ 203, 204, 205, 206, 228, 229 ].each do |id|
        assert_match(/guide_(?:rails_api|react)_cookie_authentication/, mapped.call(id).primary_assignment_block.body)
      end
      assert_includes mapped.call(228).primary_assignment_block.body, "SameSite=Lax"
      assert_includes mapped.call(231).primary_assignment_block.body, "/api/* https://YOUR-API.onrender.com/api/:splat"
      assert_includes mapped.call(230).primary_assignment_block.body, "login status (200)"
      assert_includes Lesson.find(228).primary_assignment_block.body, "borrowed-token"
      assert_includes Lesson.find(221).primary_assignment_block.body, "jwt-client"
      assert_includes mapped.call(221).primary_assignment_block.body, "cookie-client"
      assert_not_includes mapped.call(221).primary_assignment_block.body, "jwt-client"

      assert_not mapped.call(238).required?
      assert mapped.call(239).required?
      assert_equal live_video_before, ContentBlock.where(lesson_id: 221, block_type: :video).sole.metadata
      copied_blocks = ContentBlock.where(lesson_id: copy.modules.flat_map { |mod| mod.all_lessons.ids })
      copied_blocks.each do |block|
        assert_no_match(/borrowed-token|remove-borrowed-token|organizer_api|Actualize|_archive\/csg\/AUTHENTICATION/, block.body.to_s)
        required_seconds = block.metadata.fetch("video_segments", []).sum { |s| s["required"] ? s["end_seconds"] - s["start_seconds"] : 0 }
        assert_operator required_seconds, :<=, 1800
      end
      unchanged = CurriculumRepair20261119.snapshot.fetch("tables")
      counts = [ Curriculum.count, Lesson.count, ContentBlock.count, LearningPlanRevision.count ]
      CurriculumRepair20261119.new(output: StringIO.new).run(apply: true, snapshot_path: path)
      assert_equal unchanged, CurriculumRepair20261119.snapshot.fetch("tables")
      assert_equal counts, [ Curriculum.count, Lesson.count, ContentBlock.count, LearningPlanRevision.count ]
    end
  end

  test "missing or stale snapshot rolls back every change" do
    assert_raises(RuntimeError) { CurriculumRepair20261119.new(output: @output).run(apply: true) }
    snapshot_file do |path|
      @plan.update!(title: "Concurrent plan change")
      assert_raises(RuntimeError) { CurriculumRepair20261119.new(output: @output).run(apply: true, snapshot_path: path) }
    end
    assert_nil Curriculum.find_by(course_package_key: CurriculumRepair20261119::COPY_KEY)
    assert_equal "manual_complete", @block.reload.submission_type
    assert_equal "Concurrent plan change", @plan.reload.title
  end

  test "a failure after source and copy writes rolls everything back and the same snapshot can retry" do
    snapshot_file do |path|
      before = CurriculumRepair20261119.snapshot.fetch("tables")
      counts = [ Curriculum.count, Lesson.count, ContentBlock.count, LessonAssignment.count, LearningPlanRevision.count ]
      failing = Class.new(CurriculumRepair20261119) do
        private

        def persist_copy!
          super
          raise "Injected failure after copied content"
        end
      end
      error = assert_raises(RuntimeError) { failing.new(output: StringIO.new).run(apply: true, snapshot_path: path) }
      assert_match(/Injected failure/, error.message)
      assert_equal before, CurriculumRepair20261119.snapshot.fetch("tables")
      assert_equal counts, [ Curriculum.count, Lesson.count, ContentBlock.count, LessonAssignment.count, LearningPlanRevision.count ]
      assert_nil Curriculum.find_by(course_package_key: CurriculumRepair20261119::COPY_KEY)
      copy = CurriculumRepair20261119.new(output: StringIO.new).run(apply: true, snapshot_path: path)
      assert copy.draft?
      assert_equal 1, Curriculum.where(course_package_key: CurriculumRepair20261119::COPY_KEY).count
    end
  end

  test "the viewing budget spans blocks and missing required flags retain required-by-default semantics" do
    ContentBlock.create!(lesson_id: 221, block_type: :video, position: 2, video_url: "https://youtu.be/3SW_W7PmEd4",
      metadata: { video_segments: [ { "start_seconds" => 8000, "end_seconds" => 8500, "label" => "Missing required flag" }, { "start_seconds" => 8500, "end_seconds" => 9000, "label" => "Beyond lesson budget" } ] })
    CurriculumRepair20261119.new(output: @output).run
    copied = JSON.parse(@output.string).fetch("copy").fetch("content_blocks").select { |b| b["lesson_id"] == 221 }
    segments = copied.flat_map { |b| b.fetch("metadata", {}).fetch("video_segments", []) }
    assert segments.find { |item| item["label"] == "Missing required flag" }.fetch("required")
    assert_not segments.find { |item| item["label"].include?("Beyond lesson budget") }.fetch("required")
    assert_equal 1704, segments.sum { |item| item["required"] ? item["end_seconds"] - item["start_seconds"] : 0 }
  end

  test "unreviewed source dependencies refuse a partial copy" do
    LearningObjective.create!(curriculum: @curriculum, title: "New objective", code: "NEW", success_criteria: "Explain the change", position: 1)
    error = assert_raises(RuntimeError) { CurriculumRepair20261119.new(output: @output).run }
    assert_match(/extend and review copier/, error.message)
  end

  private

  def snapshot_file
    Tempfile.create("curriculum-repair") do |file|
      file.write(JSON.generate(CurriculumRepair20261119.snapshot))
      file.flush
      yield file.path
    end
  end
end

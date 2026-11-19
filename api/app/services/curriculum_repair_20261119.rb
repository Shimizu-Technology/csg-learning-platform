require "json"
require "digest"
require "cgi"

# One reviewed repair of the audited curriculum. Never runs at boot or deploy.
# Dry-run builds the entire desired tree in memory, without allocating IDs.
class CurriculumRepair20261119
  SOURCE_ID = 1
  LANCE_ENROLLMENT_ID = 3
  COPY_KEY = "csg-cohort-4-20261119"
  COPY_NAME = "CSG Full-Stack Bootcamp — Cohort 4"
  GIT_TITLE = "Git branches and pull requests"
  CONTENT_MODELS = [ Curriculum, CurriculumModule, Lesson, ContentBlock, LearningObjective, Rubric, RubricCriterion, KnowledgeCheck, ObjectiveAlignment, CurriculumResource ].freeze
  PROTECTED_MODELS = [ Progress, Submission, SubmissionCriterionResult, KnowledgeCheckAttempt, ModuleAssignment, LessonAssignment, Enrollment, Cohort ].freeze
  OLD_RESOURCES = "https://github.com/Code-School-of-Guam-Cohort-3/resources/blob/main/"
  RESOURCES = "https://github.com/Code-School-of-Guam-Alumni/Resources/blob/main/"
  GUIDE_PATHS = {
    "AUTHENTICATION/guide_implementing_rails_authentication.md" => "_archive/csg/AUTHENTICATION/guide_implementing_rails_authentication.md",
    "AUTHENTICATION/guide_implementing_react_authentication_v2.md" => "_archive/csg/AUTHENTICATION/guide_implementing_react_authentication_v2.md",
    "COMPUTER_SETUP/MAC/guide_install_react_on_mac.md" => "web-development/04-react/guide_react_crud.md",
    "CRUD/guide_react_crud.md" => "web-development/04-react/guide_react_crud.md",
    "updated/04-react/guide_react_router.md" => "web-development/04-react/guide_react_router.md",
    "updated/05-deployment/guide_deployment_to_render_and_netlify.md" => "web-development/05-deployment/guide_deployment_to_render_and_netlify.md",
    "updated/05-deployment/guide_portfolio.md" => "web-development/05-deployment/guide_portfolio.md",
    "updated/06-capstone/capstone_guide.md" => "web-development/06-capstone/capstone_guide.md"
  }.freeze
  REPEATS = ([ 148, 149 ] + (151..156).to_a + (165..169).to_a + [ 171 ] + (183..190).to_a).freeze
  VIDEO_LIMITS = [ 132, 136, 213, 216, 221, 223 ].freeze

  def self.snapshot
    modules = CurriculumModule.where(curriculum_id: SOURCE_ID)
    lessons = Lesson.where(module_id: modules.select(:id))
    blocks = ContentBlock.where(lesson_id: lessons.select(:id))
    rubrics = Rubric.where(curriculum_id: SOURCE_ID)
    checks = KnowledgeCheck.where(content_block_id: blocks.select(:id))
    submissions = Submission.where(content_block_id: blocks.select(:id))
    enrollments = Enrollment.where(cohort_id: Cohort.where(curriculum_id: SOURCE_ID).select(:id))
    plans = LearningPlan.where(enrollment_id: enrollments.select(:id))
    scopes = {
      Curriculum => Curriculum.where(id: SOURCE_ID), CurriculumModule => modules, Lesson => lessons, ContentBlock => blocks,
      LearningObjective => LearningObjective.where(curriculum_id: SOURCE_ID), Rubric => rubrics,
      RubricCriterion => RubricCriterion.where(rubric_id: rubrics.select(:id)), KnowledgeCheck => checks,
      ObjectiveAlignment => ObjectiveAlignment.where(lesson_id: lessons.select(:id)), CurriculumResource => CurriculumResource.where(curriculum_id: SOURCE_ID),
      Cohort => Cohort.where(curriculum_id: SOURCE_ID), Enrollment => enrollments,
      ModuleAssignment => ModuleAssignment.where(enrollment_id: enrollments.select(:id)), LessonAssignment => LessonAssignment.where(enrollment_id: enrollments.select(:id)),
      Progress => Progress.where(content_block_id: blocks.select(:id)), Submission => submissions,
      SubmissionCriterionResult => SubmissionCriterionResult.where(submission_id: submissions.select(:id)), KnowledgeCheckAttempt => KnowledgeCheckAttempt.where(knowledge_check_id: checks.select(:id)),
      LearningPlan => plans, LearningPlanRevision => LearningPlanRevision.where(learning_plan_id: plans.select(:id))
    }
    { "exported_at" => Time.current.iso8601, "source_commit" => ENV["RENDER_GIT_COMMIT"], "tables" => scopes.to_h { |model, scope| [ model.name, JSON.parse(scope.order(:id).map(&:attributes).to_json) ] } }
  end

  def initialize(output: $stdout)
    @output = output
  end

  def run(apply: false, snapshot_path: nil)
    ApplicationRecord.transaction do
      connection = ApplicationRecord.connection
      connection.execute("SET LOCAL lock_timeout = '5s'")
      connection.execute("SET LOCAL statement_timeout = '60s'")
      # Structure -> enrollments -> plan -> content: no learner writes can race
      # the preservation check. Dry-run takes no locks and issues no writes.
      lock_source! if apply
      if (copy = Curriculum.find_by(course_package_key: COPY_KEY))
        @output.puts JSON.generate(status: "already_applied", curriculum_id: copy.id, mapping: JSON.parse(copy.course_package_content_snapshot))
        return copy
      end
      before = self.class.snapshot
      preflight!(before)
      @shared = before.fetch("tables").deep_dup
      prepare_shared!
      @copy = @shared.slice(*CONTENT_MODELS.map(&:name)).deep_dup
      prepare_copy!
      @output.puts JSON.pretty_generate(diff(before))
      return unless apply

      raise "SNAPSHOT_PATH is required for apply" unless snapshot_path.present?
      saved = JSON.parse(File.read(snapshot_path)).fetch("tables")
      raise "Snapshot is stale or belongs to another source; export and review a fresh dry-run" unless saved == before.fetch("tables")

      protected_before = before.fetch("tables").slice(*PROTECTED_MODELS.map(&:name))
      completions_before = lance_completions
      git = persist_shared!
      copy = persist_copy!
      update_plan!(git)
      after = self.class.snapshot.fetch("tables")
      protected_after = after.slice(*PROTECTED_MODELS.map(&:name)).deep_dup
      additions = protected_after.fetch("LessonAssignment").reject { |row| protected_before.fetch("LessonAssignment").any? { |old| old["id"] == row["id"] } }
      raise "Unexpected assignment changes" unless additions.one? && additions.sole.values_at("enrollment_id", "lesson_id", "unlocked") == [ LANCE_ENROLLMENT_ID, git.id, true ]
      protected_after["LessonAssignment"] -= additions
      raise "Learner records changed; rolling back" unless protected_before == protected_after
      completions_after = lance_completions
      raise "Existing completion states changed; rolling back" unless completions_before.all? { |id, state| [ 2, 3 ].include?(id) || completions_after[id] == state }
      verify_plan!(before, after, git)
      @output.puts JSON.generate(status: "applied", curriculum_id: copy.id, git_lesson_id: git.id, protected_records_unchanged: true, existing_completions_unchanged: true)
      copy
    end
  end

  private

  def lock_source!
    Curriculum.lock_for_content!(SOURCE_ID, "FOR UPDATE")
    Cohort.where(curriculum_id: SOURCE_ID).order(:id).lock("FOR NO KEY UPDATE").load
    Enrollment.where(cohort_id: Cohort.where(curriculum_id: SOURCE_ID).select(:id)).order(:id).lock("FOR NO KEY UPDATE").load
    LearningPlan.where(enrollment_id: LANCE_ENROLLMENT_ID).lock.load
    CurriculumModule.where(curriculum_id: SOURCE_ID).order(:id).lock.load
    Lesson.where(module_id: CurriculumModule.where(curriculum_id: SOURCE_ID).select(:id)).order(:id).lock.load
    ContentBlock.where(lesson_id: Lesson.where(module_id: CurriculumModule.where(curriculum_id: SOURCE_ID).select(:id)).select(:id)).order(:id).lock.load
  end

  def preflight!(snapshot)
    tables = snapshot.fetch("tables")
    raise "Wrong source curriculum" unless tables.fetch("Curriculum").sole.fetch("name") == "CSG Full-Stack Bootcamp 2026"
    ids = tables.fetch("Lesson").map { |row| row.fetch("id") }
    raise "Audited lessons missing" unless ([ 2, 3, 4, 129, 131, 132, 136 ] + (143..237).to_a - [ 197 ]).all? { |id| ids.include?(id) }
    # Audited source has no uploaded media, objectives, rubrics, checks or course
    # files. Refuse new dependencies rather than copy incomplete relationships.
    %w[LearningObjective Rubric RubricCriterion KnowledgeCheck ObjectiveAlignment CurriculumResource].each do |name|
      raise "#{name} added since audit; extend and review copier first" if tables.fetch(name).any?
    end
    raise "Hosted media added since audit; storage verification required" if tables.fetch("ContentBlock").any? { |b| b["s3_video_key"].present? }
    plan = tables.fetch("LearningPlan").find { |row| row["enrollment_id"] == LANCE_ENROLLMENT_ID }
    raise "Lance's reviewed Nov 21 milestone is missing" unless plan && plan["milestones"].any? { |m| m["due_on"] == "2026-11-21" && m["lesson_ids"] == [ 213, 218, 219 ] }
    raise "Review author must be admin 1" unless User.find(1).admin?
  end

  def asset(name)
    Rails.root.join("config/curriculum_20261119/#{name}.html").read.strip
  end

  def lesson(rows, id) = rows.fetch("Lesson").find { |row| row["id"] == id } || raise("Lesson #{id} missing")
  def blocks(rows, id) = rows.fetch("ContentBlock").select { |row| row["lesson_id"] == id }
  def exercise(rows, id) = blocks(rows, id).find { |row| %w[exercise code_challenge].include?(row["block_type"]) } || raise("Exercise #{id} missing")

  def prepare_shared!
    @shared.fetch("Lesson").each { |row| row["title"] = csg_wording(row["title"]) }
    @shared.fetch("ContentBlock").each do |row|
      %w[title body solution].each { |key| row[key] = csg_wording(repoint(row[key])) }
    end
    [ 2, 3 ].each { |id| lesson(@shared, id)["archived_at"] ||= Time.current.iso8601 }
    # Remove the dead embed without replacing it or resetting historical watch
    # credit. Lesson 4 stays archived; its about.txt text remains intact.
    blocks(@shared, 4).select { |b| b["video_url"].to_s.include?("vimeo.com/841396051") }.each { |b| b["video_url"] = nil }
    [ 129, 131, 213, 218 ].each { |id| exercise(@shared, id)["body"] = "#{asset('wsl')}\n#{exercise(@shared, id)['body']}" }
    [ 213, 214, 215 ].each do |id|
      lesson(@shared, id)["requires_submission"] = true
      block = exercise(@shared, id)
      block["submission_type"] = "repo_url_submission"
      filename = { 213 => "week10.js", 214 => "decisions.js", 215 => "loops.js" }.fetch(id)
      extra = id == 215 ? " Include the counts before and after adding one task." : ""
      block["body"] += "<h3>Submit your work</h3><p>Push <code>#{filename}</code> in your JavaScript practice repository. Submit the repo URL and paste the output of <code>node #{filename}</code> in Notes.#{extra} Existing completions and grades are kept; no automatic credit is added.</p>"
    end
    (221..226).each { |id| exercise(@shared, id)["body"] = "#{asset('client')}\n#{asset('token')}\n#{exercise(@shared, id)['body']}" }
    exercise(@shared, 228)["body"] = "<div data-csg-fix=\"remove-borrowed-token\"><h3>Replace the borrowed token</h3><p>Remove the temporary token/header block from App.jsx. In DevTools run <code>localStorage.removeItem(\"token\")</code>, then reload so the old Axios header is gone. Build the real login form and AuthContext below. They must use the same api instance from src/lib/api.js, including api.defaults.headers.common[&quot;Authorization&quot;]. Verify that logging in sets the header, refresh restores it, and logout clears storage and the header. Do not keep two competing token setups.</p></div>\n#{exercise(@shared, 228)['body']}"
    exercise(@shared, 208)["body"] += "<p><a href=\"#{RESOURCES}web-development/03-rails/guide_api_versioning.md\">CSG API versioning guide</a>: move every route and controller together, then retest in HTTPie before connecting React.</p>"
    exercise(@shared, 230)["body"] = asset("deploy")
    [ 230, 231 ].each do |id|
      lesson(@shared, id)["requires_submission"] = true
      exercise(@shared, id)["submission_type"] = "repo_and_live_url_submission"
    end
    exercise(@shared, 231)["body"] += "<h3>Submit your work</h3><p>Submit your frontend repository URL and live Netlify URL in their separate fields. In Notes record that login works on the live site and refreshing /login loads. Use <code>VITE_API_BASE_URL=https://YOUR-API.onrender.com/api/v1</code> in Netlify, read once by Axios; requests use paths such as /tasks. Add <code>/* /index.html 200</code> to <code>public/_redirects</code>, then rebuild. Never put a secret in a VITE_ variable.</p>"
    git = lesson(@shared, 131).merge("id" => -1, "title" => GIT_TITLE, "lesson_type" => "exercise", "required" => true, "requires_submission" => true, "position" => 0)
    @shared.fetch("Lesson") << git
    @shared.fetch("ContentBlock") << { "id" => -1, "lesson_id" => -1, "block_type" => "exercise", "title" => "Submit your pull request", "body" => asset("git"), "position" => 1, "submission_type" => "text_submission", "filename" => "pull-request.md", "submission_config" => { "runner" => { "enabled" => false } }, "metadata" => { "repair" => COPY_KEY, "language" => "markdown" } }
  end

  def csg_wording(text) = text&.gsub(/Actualize/i, "CSG")

  def repoint(text)
    return text unless text

    text.gsub(%r{#{Regexp.escape(OLD_RESOURCES)}([^\s"<>\)]+)}) do
      path = Regexp.last_match(1)
      mapped = GUIDE_PATHS.fetch(path) { raise "Unmapped frozen guide #{path}; review its maintained equivalent" }
      RESOURCES + mapped
    end.gsub("https://render.com/docs/deploy-rails-6-7", "https://render.com/docs/deploy-rails-8")
  end

  def prepare_copy!
    @copy.fetch("Lesson").each do |row|
      row["title"] = generic(row["title"])
      row["required"] = false if row["title"].match?(/\AOptional\b/i) || row["title"].include?("Optional Additional Resources")
    end
    @copy.fetch("ContentBlock").each do |row|
      %w[title body solution].each { |key| row[key] = generic(row[key]) }
      row["metadata"] = row.fetch("metadata", {}).except("reference_map_scope", "reference_map_lesson_url")
      row["metadata"]["curriculum_20261119_source_lesson_id"] = row["lesson_id"]
      row["body"] = row["body"]&.gsub(%r{<div data-csg-fix="(?:borrowed-token|remove-borrowed-token)">.*?</div>}m, "")
    end
    # Login and session restoration precede the FIRST protected read, not only
    # create/update/delete. Introduce forms and router scaffolding in 228.
    order = [ 228, 229, 221, 222, 223, 224, 225, 226, 227, 230, 231, 232, 233, 234, 235, 236, 237 ]
    days = (73..110).reject { |day| [ 5, 6 ].include?(day % 7) }
    order.each_with_index { |id, index| lesson(@copy, id)["release_day"] = days.fetch(index) }
    exercise(@copy, 228)["body"] = "<h3>Before API reads: forms and routes</h3><p>Your static components and props are working. Install react-router-dom and Axios. Create a Layout with Navbar links and an Outlet, and create routes for /, /signup and /login using createBrowserRouter and RouterProvider. Start the forms with email/password fields and onSubmit handlers. Call event.preventDefault(), read FormData, and POST signup to /users and login to /login through the shared Axios client. Configure its base URL once from VITE_API_BASE_URL, including /api/v1. Show validation errors and keep the form usable after a failed request. Keep the task page as a static placeholder until the login and session lessons pass. No borrowed token is needed.</p>" + exercise(@copy, 228)["body"]
    [ 221, 222, 223, 224, 225, 226 ].each do |id|
      exercise(@copy, id)["body"] = "<p><strong>Prerequisite:</strong> finish signup/login and session restoration first. Sign in through your React login form. AuthContext sends the Bearer token; keep Rails authorization enabled. Check a missing/invalid session returns to login and each user sees only their own data.</p>" + exercise(@copy, id)["body"]
    end
    exercise(@copy, 228)["body"] = asset("client") + exercise(@copy, 228)["body"]
    rewrite_repeats!
    VIDEO_LIMITS.each { |id| trim_video!(id) }
  end

  def generic(text)
    return text unless text

    text.gsub(%r{<p><a href="https://github.com/Code-School-of-Guam-Alumni/Learning-Examples/blob/main/LANCE\.md[^"]*">.*?</a></p>}m, "")
      .gsub(/organizer_frontend/i, "mini_capstone_frontend").gsub(/organizer_api/i, "mini_capstone_api")
      .gsub(/the Organizer React Client/i, "your mini-capstone React client").gsub(/the Organizer MVP/i, "your mini-capstone MVP")
      .gsub(/\b(?:your |the )?organizer\b/i, "your mini-capstone")
  end

  def rewrite_repeats!
    REPEATS.each do |id|
      row = lesson(@copy, id)
      row["title"] = "Practice: #{row['title']}" unless row["title"].start_with?("Practice:")
      optional = id.between?(165, 169) || id.between?(183, 190)
      row["required"] = false if optional
      row["title"] = "Optional: #{row['title']}" if optional
      target = id.between?(183, 190) ? "a separate Library Management System practice API" : "your existing mini-capstone API"
      focus = case id
      when 148, 153 then "create one valid record and one invalid record; explain the saved attributes and validation response"
      when 149 then "run index, show, create, update and destroy against the same resource, one request at a time"
      when 151, 171, 189 then "add repeat-safe demo seed data, run it twice, and check that the second run creates no duplicates"
      when 152 then "read the collection through index and verify the JSON matches the stored records"
      when 154 then "read one record through show and test a missing ID"
      when 155 then "update one record and prove the other records did not change"
      when 156 then "delete one record and verify the second delete has an intentional missing-record response"
      else "apply the named topic without replaying the full CRUD tutorial, then test a happy path and a failure path"
      end
      exercise(@copy, id)["body"] = "<p>You have completed the first Rails console, API, seeding and params lessons. This is #{optional ? 'optional retrieval practice' : 'practice applying it to your own project'}, not another follow-along build.</p><p>In #{target}, #{focus}. Use the model names and attributes in your own schema. For HTTP requests use the HTTPie desktop app, one tab per request, with name/value rows in Params. Read the response and the Rails log after every request.</p><p>Try it from memory first, then consult the <a href=\"#{RESOURCES}web-development/03-rails/guide_rails_api_crud.md\">CSG Rails CRUD guide</a> if needed. Explain one difference between your app and the guide. Do not copy unrelated model names into error handling.</p><p>Commit on a feature branch, push and open a PR. Submit your work using the existing field below; include the PR link and tested request/status results in Notes (or in the text answer). Done when the change works, the failure is handled, and your evidence explains both.</p>"
      blocks(@copy, id).select { |b| b["metadata"].key?("video_segments") }.each do |block|
        block["metadata"]["video_segments"].each { |segment| segment["required"] = false }
      end
    end
  end

  def trim_video!(id)
    blocks(@copy, id).each do |block|
      segments = block.fetch("metadata", {})["video_segments"]
      next unless segments

      # Keep the original reviewed boundaries intact. Where no focused <=30m
      # section exists, the written exercise teaches the required work and the
      # full recording becomes optional review. Never invent unreviewed cuts.
      budget = 1_800
      segments.each do |segment|
        length = segment.fetch("end_seconds") - segment.fetch("start_seconds")
        required = segment["required"] && length <= budget
        segment["required"] = !!required
        segment["label"] = "Optional review: #{segment['label']}" unless required
        budget -= length if required
      end
      block["metadata"]["video_segments_review_method"] = "20261119_required_budget_original_boundaries"
    end
    body = exercise(@copy, id)["body"]
    body = body.gsub(%r{<p><strong>Watch:</strong>.*?</p>}m, "")
    exercise(@copy, id)["body"] = "<p><strong>Viewing:</strong> only sections marked Required in the player are required (at most 30 minutes total). Other sections are optional review. The written exercise and submission remain required; use the guide when a recording section is optional.</p>" + body
  end

  def diff(before)
    changes = CONTENT_MODELS.flat_map do |model|
      original = before.fetch("tables").fetch(model.name).index_by { |row| row["id"] }
      @shared.fetch(model.name).filter_map do |row|
        old = original[row["id"]]
        fields = row.keys.select { |key| !old || row[key] != old[key] }.to_h { |key| [ key, { before: old&.[](key), after: row[key] } ] }
        { model: model.name, id: row["id"], fields: fields } if fields.any?
      end
    end
    { mode: "dry_run_plan", shared_changes: changes, plan_addition: { enrollment_id: LANCE_ENROLLMENT_ID, due_on: "2026-11-21", lesson: GIT_TITLE },
      copy: { name: COPY_NAME, status: "draft", assigned_cohorts: 0, lessons: @copy.fetch("Lesson"), content_blocks: @copy.fetch("ContentBlock") } }
  end

  def persist_shared!
    @shared.fetch("Lesson").reject { |row| row["id"] == -1 }.each { |row| update_row!(Lesson, row) }
    @shared.fetch("ContentBlock").reject { |row| row["id"] == -1 }.each { |row| update_row!(ContentBlock, row) }
    attrs = @shared.fetch("Lesson").find { |row| row["id"] == -1 }.except("id", "created_at", "updated_at")
    git = Lesson.create!(attrs)
    attrs = @shared.fetch("ContentBlock").find { |row| row["id"] == -1 }.except("id", "lesson_id")
    git.content_blocks.create!(attrs)
    # Only new assignment, to the new lesson. Existing assignment rows untouched.
    LessonAssignment.create!(enrollment_id: LANCE_ENROLLMENT_ID, lesson: git, unlocked: true)
    git
  end

  def update_row!(model, desired)
    record = model.find(desired.fetch("id"))
    changed = desired.except("id", "created_at", "updated_at").reject { |key, value| JSON.parse(record.attributes.to_json)[key] == value }
    return if changed.empty?

    if model == ContentBlock && record.lesson_id == 4 && changed.keys == [ "video_url" ] && changed["video_url"].nil?
      # Retirement is not replacement: retain historical video/progress rows.
      record.update_columns(video_url: nil, updated_at: Time.current)
    else
      record.update!(changed)
    end
  end

  def persist_copy!
    source = @copy.fetch("Curriculum").sole.except("id", "created_at", "updated_at", "course_package_key", "course_package_digest", "course_package_content_snapshot", "course_package_revision")
    copy = Curriculum.create!(source.merge("name" => COPY_NAME, "status" => "draft", "course_package_key" => COPY_KEY))
    module_map = insert_copies(CurriculumModule, @copy.fetch("CurriculumModule")) { |row| row["curriculum_id"] = copy.id }
    lesson_map = insert_copies(Lesson, @copy.fetch("Lesson")) { |row| row["module_id"] = module_map.fetch(row["module_id"]) }
    block_map = insert_copies(ContentBlock, @copy.fetch("ContentBlock")) { |row| row["lesson_id"] = lesson_map.fetch(row["lesson_id"]) }
    # No learner or assignment data is copied; new curriculum stays unassigned.
    ContentBlock.where(id: block_map.values).find_each do |block|
      body = block.body&.gsub(%r{/(lessons|modules)/(\d+)(#block-(\d+))?}) do |match|
        kind, old_id, _, old_block = Regexp.last_match.captures
        mapped = (kind == "lessons" ? lesson_map : module_map)[old_id.to_i]
        mapped ? "/#{kind}/#{mapped}#{old_block ? "#block-#{block_map.fetch(old_block.to_i)}" : ''}" : match
      end
      block.update!(body: body) if body != block.body
    end
    copy.update!(course_package_content_snapshot: JSON.generate(lesson_ids: lesson_map, module_ids: module_map), course_package_revision: "2026-11-19")
    copy
  end

  def insert_copies(model, rows)
    rows.to_h do |row|
      attrs = row.except("id", "created_at", "updated_at")
      yield attrs
      [ row.fetch("id"), model.create!(attrs).id ]
    end
  end

  def update_plan!(git)
    plan = LearningPlan.find_by!(enrollment_id: LANCE_ENROLLMENT_ID)
    milestones = plan.milestones.deep_dup
    milestones.find { |m| m["due_on"] == "2026-11-21" }.fetch("lesson_ids").unshift(git.id)
    plan.update!(milestones: milestones)
    plan.revisions.create!(author_id: 1, snapshot: plan.snapshot)
  end

  def lance_completions
    progress = LearnerProgress.new(Enrollment.find(LANCE_ENROLLMENT_ID))
    progress.lessons.to_h { |item| [ item.id, progress.lesson_progress(item).then { |p| [ p.status, p.completed ] } ] }
  end

  def verify_plan!(before, after, git)
    original = before.fetch("tables").fetch("LearningPlan").find { |p| p["enrollment_id"] == LANCE_ENROLLMENT_ID }
    current = after.fetch("LearningPlan").find { |p| p["enrollment_id"] == LANCE_ENROLLMENT_ID }
    restored = current.deep_dup
    restored["milestones"].each { |m| m["lesson_ids"].delete(git.id) }
    ignored = %w[updated_at lock_version]
    raise "Plan changed beyond the Git addition" unless restored.except(*ignored) == original.except(*ignored)
    raise "New lesson not assigned and required" unless LearnerProgress.new(Enrollment.find(LANCE_ENROLLMENT_ID)).lessons.any? { |l| l.id == git.id && l.required? }
    # The only protected-table addition allowed is the explicit Git assignment.
  end
end

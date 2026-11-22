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
      defer_live_links!(before)
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

  # Separate, explicitly held phase: run only once student access is arranged.
  def run_repoint(apply: false, snapshot_path: nil, access_confirmed: false)
    ApplicationRecord.transaction do
      ApplicationRecord.connection.execute("SET LOCAL lock_timeout = '5s'")
      ApplicationRecord.connection.execute("SET LOCAL statement_timeout = '60s'")
      lock_source! if apply
      raise "Apply the primary repair before re-pointing guides" unless Curriculum.exists?(course_package_key: COPY_KEY)

      before = self.class.snapshot
      @shared = before.fetch("tables").deep_dup
      @shared.fetch("ContentBlock").each do |row|
        row["body"] = repoint(row["body"])
        row["solution"] = repoint(row["solution"])
        if row["lesson_id"] == 230 && row["body"]
          current_intro = asset("deploy").match(%r{\A<p>.*?</p>}m).to_s
          row["body"] = row["body"].sub(%r{<p data-csg-link-hold="deploy-guide">.*?</p>}m, current_intro)
        end
        if [ 129, 131, 213, 218 ].include?(row["lesson_id"]) && row["body"]&.include?('data-csg-fix="terminal"')
          node_link = asset("wsl").match(%r{<a href="[^"]+/install_node\.md">.*?</a>}).to_s
          row["body"] = row["body"].sub("CSG setup instructions from your instructor", node_link)
        end
      end
      git_id = @shared.fetch("Lesson").find { |row| row["title"] == GIT_TITLE }.fetch("id")
      git_link = asset("git").match(%r{<p><a href="[^"]+/branches_and_pull_requests\.md">.*?</a></p>}).to_s
      exercise(@shared, git_id)["body"] = exercise(@shared, git_id)["body"].sub(%r{<p data-csg-link-hold="git-guide">.*?</p>}, git_link)
      unless exercise(@shared, 208)["body"].include?("web-development/03-rails/guide_api_versioning.md")
        exercise(@shared, 208)["body"] += version_reference
      end
      originals = before.fetch("tables").fetch("ContentBlock").index_by { |row| row["id"] }
      changes = @shared.fetch("ContentBlock").filter_map do |row|
        fields = %w[body solution].select { |key| row[key] != originals.fetch(row["id"])[key] }
        { id: row["id"], lesson_id: row["lesson_id"], fields: fields.to_h { |key| [ key, { before: originals.fetch(row["id"])[key], after: row[key] } ] } } if fields.any?
      end
      @output.puts JSON.pretty_generate(mode: "dry_run_repoint", held_until: "Lance has Resources read access", changes: changes)
      return unless apply && changes.any?

      raise "Resources access must be confirmed before re-pointing live guides" unless access_confirmed
      raise "SNAPSHOT_PATH is required for apply" unless snapshot_path.present?
      raise "Snapshot is stale; export and review again" unless JSON.parse(File.read(snapshot_path)).fetch("tables") == before.fetch("tables")

      states_before = lance_completions
      protected = PROTECTED_MODELS.map(&:name) + %w[LearningPlan LearningPlanRevision]
      @shared.fetch("ContentBlock").each { |row| update_row!(ContentBlock, row) }
      after = self.class.snapshot.fetch("tables")
      raise "Re-point changed learner or plan records" unless before.fetch("tables").slice(*protected) == after.slice(*protected)
      raise "Re-point changed completion states" unless states_before == lance_completions

      @output.puts JSON.generate(status: "repoint_applied", changed_blocks: changes.size)
    end
  end

  def self.copy_reference_snapshot
    copy = Curriculum.find_by!(course_package_key: COPY_KEY)
    lessons = Lesson.where(module_id: copy.modules.select(:id))
    snapshot.merge("copy_tables" => {
      "Curriculum" => [ copy ], "CurriculumModule" => copy.modules.order(:id),
      "Lesson" => lessons.order(:id), "ContentBlock" => ContentBlock.where(lesson_id: lessons.select(:id)).order(:id)
    }.transform_values { |records| JSON.parse(records.map(&:attributes).to_json) })
  end

  # Follow-up for copies made before personal reference-list items were removed.
  # The source curriculum and all learner/plan records must remain byte-for-byte equal.
  def run_copy_references(apply: false, snapshot_path: nil)
    ApplicationRecord.transaction do
      connection = ApplicationRecord.connection
      connection.execute("SET LOCAL lock_timeout = '5s'")
      connection.execute("SET LOCAL statement_timeout = '60s'")
      lock_source! if apply
      copy = Curriculum.find_by!(course_package_key: COPY_KEY)
      copy.lock! if apply
      raise "Reference repair only supports an unassigned draft" unless copy.draft? && !copy.cohorts.exists?

      if apply
        copy.modules.order(:id).lock.load
        Lesson.where(module_id: copy.modules.select(:id)).order(:id).lock.load
        ContentBlock.where(lesson_id: Lesson.where(module_id: copy.modules.select(:id)).select(:id)).order(:id).lock.load
      end
      before = self.class.copy_reference_snapshot
      changes = before.fetch("copy_tables").fetch("ContentBlock").filter_map do |row|
        fields = %w[body solution].filter_map do |key|
          value = generic(row[key])
          [ key, { before: row[key], after: value } ] if value != row[key]
        end.to_h
        { id: row["id"], lesson_id: row["lesson_id"], fields: fields } if fields.any?
      end
      @output.puts JSON.pretty_generate(mode: "dry_run_copy_references", curriculum_id: copy.id, changes: changes)
      return unless apply && changes.any?

      raise "SNAPSHOT_PATH is required for apply" unless snapshot_path.present?
      saved = JSON.parse(File.read(snapshot_path))
      raise "Snapshot is stale; export and review again" unless saved.except("exported_at", "source_commit") == before.except("exported_at", "source_commit")

      changes.each do |change|
        row = before.fetch("copy_tables").fetch("ContentBlock").find { |block| block["id"] == change[:id] }.deep_dup
        change[:fields].each { |key, values| row[key] = values[:after] }
        update_row!(ContentBlock, row)
      end
      raise "Source or learner records changed; rolling back" unless self.class.snapshot.fetch("tables") == before.fetch("tables")

      @output.puts JSON.generate(status: "copy_references_applied", curriculum_id: copy.id, changed_blocks: changes.size, source_and_learner_records_unchanged: true)
    end
  end

  private

  def version_reference
    "<p><a href=\"#{RESOURCES}web-development/03-rails/guide_api_versioning.md\">CSG API versioning guide</a>: move every route and controller together, then retest in HTTPie before connecting React.</p>"
  end

  def defer_live_links!(before)
    originals = before.fetch("tables").fetch("ContentBlock").index_by { |row| row["id"] }
    @shared.fetch("ContentBlock").each do |row|
      original_row = originals[row["id"]]
      row["solution"] = csg_wording(original_row["solution"]) if original_row
      next unless row["body"]

      original = original_row&.fetch("body").to_s
      body = row["body"].gsub(%r{<a href="#{Regexp.escape(RESOURCES)}web-development/01-setup/install_node\.md">.*?</a>}, "CSG setup instructions from your instructor")
      if row["lesson_id"] == -1
        body = body.gsub(%r{<p><a href="#{Regexp.escape(RESOURCES)}web-development/02-git-github/branches_and_pull_requests\.md">.*?</a></p>}, '<p data-csg-link-hold="git-guide">The complete branch and PR steps are above. The matching CSG guide will be linked once access is arranged.</p>')
      end
      body = body.gsub(%r{<p><a href="#{Regexp.escape(RESOURCES)}web-development/03-rails/guide_api_versioning\.md">.*?</p>}, "") if row["lesson_id"] == 208
      row["body"] = body.gsub(%r{https://github.com/Code-School-of-Guam-Alumni/Resources/[^\s"<>\)]+}) do |url|
        next url if original.include?(url)

        match = GUIDE_PATHS.find { |old, current| url == RESOURCES + current && original.include?(OLD_RESOURCES + old) }
        raise "No accessible original for held guide #{url}" unless match

        OLD_RESOURCES + match.first
      end
      if row["lesson_id"] == 230
        old_guide = row["body"].match(%r{<a href="#{Regexp.escape(OLD_RESOURCES)}updated/05-deployment/guide_deployment_to_render_and_netlify\.md">.*?</a>}).to_s
        intro = "<p data-csg-link-hold=\"deploy-guide\">Deploy Rails to Render and React to Netlify. Follow this written checklist and the Render Rails 8 documentation below for current settings. #{old_guide} is the frozen Cohort 3 reference; its old build commands are superseded by this checklist. Maintained-guide access is being arranged.</p>"
        row["body"] = row["body"].sub(%r{\A<p>.*?</p>}m, intro)
      end
    end
  end

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
    exercise(@shared, 208)["body"] += version_reference
    [ 203, 204, 205, 206, 228, 229 ].each do |id|
      exercise(@shared, id)["body"] += "<p>HTTPie desktop: signup, login and password changes use Body → Form → URL-encoded name/value rows. Never put passwords, tokens or other secrets in Params or the URL. Params are for non-sensitive query values such as search, filters and IDs. Send Bearer tokens in the Auth panel.</p>"
    end
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
    # Versioning is a prerequisite of the cookie guides' Api::V1 controllers.
    lesson(@copy, 208)["release_day"] = 49
    [ 203, 204, 205, 206 ].each_with_index { |id, index| lesson(@copy, id)["release_day"] = 50 + index }
    lesson(@copy, 207).merge!("release_day" => 53, "position" => 2)
    (143..146).each do |id|
      exercise(@copy, id)["body"] += "<p>For now, use fictional local data, plain JSON and a happy-path create so you can see the request/controller/database flow. This is a named learning step: versioned routes follow in the API-versioning lesson before authentication; validations and useful failure responses arrive in the validations/happy-and-sad-path unit; serializers follow in the serializer unit; session authentication and ownership checks come before deployment. Do not deploy an unprotected multi-user app.</p>"
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
    use_cookie_sessions!
    rewrite_repeats!
    VIDEO_LIMITS.each { |id| trim_video!(id) }
  end

  def use_cookie_sessions!
    rails_guide = "#{RESOURCES}web-development/03-rails/guide_rails_api_cookie_authentication.md"
    react_guide = "#{RESOURCES}web-development/04-react/guide_react_cookie_authentication.md"
    @copy.fetch("ContentBlock").each do |block|
      next unless block["body"]

      block["body"] = block["body"].gsub(%r{<div data-csg-fix="jwt-client">.*?</div>}m, "")
        .gsub("#{RESOURCES}_archive/csg/AUTHENTICATION/guide_implementing_rails_authentication.md", rails_guide)
        .gsub("#{RESOURCES}_archive/csg/AUTHENTICATION/guide_implementing_react_authentication_v2.md", react_guide)
        .gsub("AuthContext sends the Bearer token", "AuthContext restores the cookie session")
        .gsub("Verify protected requests require a valid bearer token", "Verify protected requests require a valid session and all writes require a matching CSRF token")
        .gsub("missing or invalid token and two-user data isolation", "missing or expired session, invalid CSRF on writes, and two-user data isolation")
        .gsub("Allow the Vite development URL in backend CORS", "Configure Vite server.proxy for /api and set VITE_API_BASE_URL=/api/v1")
    end
    [ 198, 199, 200, 201, 202 ].each do |id|
      exercise(@copy, id)["body"] += "<p>For the authentication lessons that follow, this curriculum uses the <a href=\"#{rails_guide}\">CSG Rails cookie-session guide</a>. Keep serializers limited to safe user fields; never expose password_digest or session secrets.</p>"
    end
    [ 203, 204, 205, 206, 208, 228, 229, 231 ].each do |id|
      exercise(@copy, id)["body"] = asset("cookie-#{id}")
    end
    lesson(@copy, 205)["title"] = "Log In with a Rails Session"
    exercise(@copy, 212)["body"] = exercise(@copy, 212)["body"].gsub(/authentication header/i, "session cookie and CSRF header")
    [ 221, 222, 223, 224, 225, 226, 228, 229 ].each do |id|
      exercise(@copy, id)["body"] = asset("cookie-client") + exercise(@copy, id)["body"]
    end
    exercise(@copy, 230)["body"] = exercise(@copy, 230)["body"]
      .gsub("Put Bearer tokens in the Auth panel, never the URL.", "Keep HTTPie's session cookie jar enabled. Fetch /api/v1/csrf and send X-CSRF-Token on writes, refreshing it after login.")
      .gsub("Check missing-token and second-user requests too.", "Check missing/expired sessions, CSRF rejection, and a second user too.")
      .gsub("live login status (201 for the class API), without the response token or credentials", "live session login status (200), without cookie values, CSRF values or credentials")
    exercise(@copy, 230)["body"] += "<p>For this cookie-session curriculum, keep auth responses at Cache-Control: no-store and personalized API responses uncached. Follow the maintained deployment guide for Render TLS termination, including config.assume_ssl = true in production when needed; keep force_ssl and CSRF protection enabled.</p>"
    exercise(@copy, 232)["body"] = "<p>This optional diagnostic lab contrasts cross-origin requests with the required same-origin proxy route. Reproduce a harmless direct cross-origin failure locally, inspect the Console and Network panels, then restore Vite's /api proxy. Do not disable CSRF or change production cookie settings. The normal course flow uses first-party SameSite=Lax cookies and does not require browser calls to the Render hostname.</p><p>Use the <a href=\"#{RESOURCES}web-development/05-deployment/guide_deployment_to_render_and_netlify.md\">same-origin deployment guide</a>. Explain how a proxy routing error, an API 401/422, and a browser CORS rejection differ. This recording is optional context.</p>"
    # These historical clips teach token auth or direct cross-origin deployment.
    # Keep them available as optional contrast; the cookie guides teach the work.
    [ 203, 204, 205, 206, 231 ].each do |id|
      blocks(@copy, id).each do |block|
        block.fetch("metadata", {}).fetch("video_segments", []).each do |segment|
          segment["required"] = false
          segment["label"] = "Optional historical approach: #{segment['label']}"
        end
      end
    end
  end

  def generic(text)
    return text unless text

    clean = text.gsub(%r{<p><a href="https://github.com/Code-School-of-Guam-Alumni/Learning-Examples/blob/main/LANCE\.md[^"]*">.*?</a></p>}m, "")
    clean = clean.gsub(%r{<section data-csg-reference-map="[^"]+">.*?</section>}m) do |section|
      section.gsub(%r{<li>.*?</li>}m) do |item|
        item.match?(%r{\bLance\b|github\.com/Code-School-of-Guam-Cohort-3/(?:organizer_api|mini_capstone_api)/}i) ? "" : item
      end
    end
    # Project names in prose are generic; reference URLs retain their real paths.
    clean.split(%r{(https?://[^\s"<>]+)}).each_with_index.map do |part, index|
      next part if index.odd?

      part.gsub(/organizer_frontend/i, "mini_capstone_frontend").gsub(/organizer_api/i, "mini_capstone_api")
        .gsub(/the Organizer React Client/i, "your mini-capstone React client").gsub(/the Organizer MVP/i, "your mini-capstone MVP")
        .gsub(/\b(?:your |the )?organizer\b/i, "your mini-capstone")
    end.join
  end

  def rewrite_repeats!
    REPEATS.each do |id|
      row = lesson(@copy, id)
      row["title"] = "Practice: #{row['title']}" unless row["title"].start_with?("Practice:")
      optional = id.between?(165, 169) || id.between?(183, 190)
      row["required"] = false if optional
      row["title"] = "Optional: #{row['title']}" if optional
      target = if id.between?(183, 190)
        "a separate Library Management System practice API"
      elsif id.between?(151, 169) || id == 171
        "your local practice_api"
      else
        "your existing mini-capstone API"
      end
      focus = case id
      when 148 then "generate a model for your own domain, inspect its migration, migrate, check schema.rb, and create fictional demo data. For now verify the happy path; add validation failures in the later validations unit"
      when 153 then "create one fictional record through the API and verify its saved attributes. For now this practices the happy path; the validations unit adds invalid-data handling"
      when 149 then "run index, show, create, update and destroy against the same fictional resource, one request at a time; implement from memory before consulting the reference"
      when 151 then "generate a Person model with name and age, inspect and run its migration, seed fictional people, and verify Person.all in rails console"
      when 165 then "generate and boot a new API, verify its welcome page, then stop the server and push the separate repository"
      when 166 then "generate a Recipe model with name, chef, ingredients, directions and prep_time, inspect the migration, migrate, and verify schema.rb"
      when 167 then "create three fictional recipes in rails console, read them in different ways, update one, then delete one; explain which operations persist"
      when 168 then "generate the recipes controller and implement CRUD from memory, explaining each action; use the earlier full teaching pass only when stuck"
      when 169 then "add GET index/show, POST create, PUT/PATCH update and DELETE destroy routes, and test each through HTTPie; submit the route/request/status evidence"
      when 171, 189 then "upgrade the earlier simple .create seed to repeat-safe demo data, run it twice, and check that the second run creates no duplicates. Never drop a production database to reseed. In the library lab include at least five authors and ten books"
      when 152 then "read the collection through index and verify the JSON matches the stored records"
      when 154 then "read one record through show and test a missing ID"
      when 155 then "update one record and prove the other records did not change"
      when 156 then "delete one record and verify the second delete has an intentional missing-record response"
      when 183 then "plan books and authors, create and boot the API, and record the model/migration/validation/route acceptance checklist; this is an integrated transfer exercise"
      when 184 then "generate Author (name, age, nationality) and Book (title, genre, published_year, available) with appropriate types; migrate and inspect the schema"
      when 185 then "use new migrations to add author biography, remove nationality, add book page_count and ISBN, and rename available to checked_out; verify the schema after each migration"
      when 186 then "require author name and positive age; require book title, genre and published_year, unique ISBN and positive page_count; default checked_out to false. Prove valid and invalid cases in rails console"
      when 187 then "generate controllers and CRUD routes for both models, implementing from memory and testing one action/route at a time; explain any model-name changes in error handling"
      when 188 then "test missing fields, invalid age, duplicate ISBN, missing records and invalid updates, plus valid CRUD; return meaningful JSON and status codes"
      when 190 then "check both models, migrations, controllers, routes, validations, seeds and happy/sad responses; write which step was difficult, the exact error, how you debugged it and which reference helped"
      else raise "Unspecified practice focus #{id}"
      end
      acceptance = id < 171 ? "the happy path works and your evidence names the invalid/missing-data cases to revisit in the later validation and sad-path unit" : "the change works, the failure is handled, and your evidence explains both"
      exercise(@copy, id)["body"] = "<p>You have completed the first Rails console, API, seeding and params lessons. This is #{optional ? 'optional retrieval practice' : 'practice applying it to your own project'}, not another follow-along build.</p><p>In #{target}, #{focus}. Use the model names and attributes in your own schema. For HTTP requests use the HTTPie desktop app, one tab per request, with name/value rows in Params. Read the response and the Rails log after every request.</p><p>Try it from memory first, then consult the <a href=\"#{RESOURCES}web-development/03-rails/guide_rails_api_crud.md\">CSG Rails CRUD guide</a> if needed. Explain one difference between your app and the guide. Do not copy unrelated model names into error handling.</p><p>Commit on a feature branch, push and open a PR. Submit your work using the existing field below; include the PR link and tested request/status results in Notes (or in the text answer). Done when #{acceptance}.</p>"
      blocks(@copy, id).select { |b| b["metadata"].key?("video_segments") }.each do |block|
        block["metadata"]["video_segments"].each { |segment| segment["required"] = false }
      end
    end
  end

  def trim_video!(id)
    budget = 1_800
    blocks(@copy, id).each do |block|
      segments = block.fetch("metadata", {})["video_segments"]
      next unless segments

      # Keep the original reviewed boundaries intact. Where no focused <=30m
      # section exists, the written exercise teaches the required work and the
      # full recording becomes optional review. Never invent unreviewed cuts.
      segments.each do |segment|
        # Browser arithmetic is prework review; keep the Node/variables/objects
        # progression required instead of dropping its final core concept.
        if id == 213 && [ "Use JavaScript in the browser console", "Practice console.log and arithmetic" ].include?(segment["label"])
          segment["required"] = false
        end
        length = segment.fetch("end_seconds") - segment.fetch("start_seconds")
        required = segment.fetch("required", true) != false && length <= budget
        segment["required"] = !!required
        segment["label"] = "Optional review: #{segment['label']}" unless required
        budget -= length if required
      end
      block["metadata"]["video_segments_review_method"] = "20261119_required_budget_original_boundaries"
    end
    body = exercise(@copy, id)["body"]
    body = body.gsub(%r{<p><strong>Watch:</strong>.*?</p>}m, "")
    if id == 132
      body = body.gsub("Follow the video in creating the Task Tracker CLI", "Try building the Task Tracker CLI from the prework concepts first; use the optional recording as a walkthrough if needed")
    end
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
    # Match the editor's optimistic-lock boundary after a batch authoring edit.
    record.lesson.touch if model == ContentBlock
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

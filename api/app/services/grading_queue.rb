# The Grading workbench's queue (GET /api/v1/grading_queue, W7 PR 7.3).
#
# One page of attempts in the staff member's scope, with the counts and filter
# options the workbench shows beside it. Everything is filtered and counted
# here, so the page, the status chips and the module and student options agree
# however much work is waiting. Rows carry no answer text: the review fetches
# the full submission (GET /submissions/:id) when an item is opened.
#
# Scope: the cohort named, or every cohort the viewer can teach (all of them
# for an admin). Filters: status (ungraded, redo or all), module, student and
# lesson. "Latest attempt" is Submission.latest_attempts, computed inside the
# filtered scope: every filter here keeps or drops all attempts of an
# (enrollment, user, block) together, so the latest attempt is the same with
# or without them.
#
# Order: oldest first (the work that has waited longest), or newest first; ids
# break ties. focus_id serves the page that holds that submission, so a review
# opened from a link, or Save and next across a page boundary, lands on the
# right page. previous and next are the items just outside the page, so
# Previous and Next keep walking the whole list.
#
# Query count is fixed: it does not grow with the number of rows.
class GradingQueue
  PER_PAGE = 50
  MAX_PER_PAGE = 100
  STATUSES = %w[ungraded redo all].freeze

  def initialize(viewer:, cohort: nil, status: "ungraded", module_id: nil, student_id: nil, lesson_id: nil,
    suggestion_outcome: nil, sort: "oldest", page: 1, per_page: PER_PAGE, focus_id: nil, now: Time.current)
    @viewer = viewer
    @cohort = cohort
    @status = STATUSES.include?(status.to_s) ? status.to_s : "ungraded"
    @module_id = positive_id(module_id)
    @student_id = positive_id(student_id)
    @lesson_id = positive_id(lesson_id)
    @suggestion_outcome = SubmissionGradeSuggestion::OUTCOMES.include?(suggestion_outcome.to_s) ? suggestion_outcome.to_s : nil
    @newest = sort.to_s == "newest"
    @per_page = positive_id(per_page)&.clamp(1, MAX_PER_PAGE) || PER_PAGE
    @page = positive_id(page) || 1
    @focus_id = positive_id(focus_id)
    @now = now
  end

  def as_json(*)
    counts = status_counts
    total = counts.fetch(@status.to_sym)
    total_pages = [ (total.to_f / @per_page).ceil, 1 ].max
    page = (focused_page || @page).clamp(1, total_pages)
    offset = (page - 1) * @per_page
    start = [ offset - 1, 0 ].max
    rows = ordered(status_scope(filtered_scope)).offset(start).limit(@per_page + (offset.positive? ? 2 : 1)).to_a
    extended_enrollments = rows.filter_map(&:enrollment).uniq(&:id).select { |item| item.cohort.personal_pace? || item.learner_extensions.any?(&:effective?) }
    @submission_windows = SubmissionWindowContext.for_all(extended_enrollments)
    previous = offset.positive? ? rows.shift : nil
    following = rows.length > @per_page ? rows.pop : nil
    latest_ids = Submission.latest_attempt_ids_for([ previous, *rows, following ].compact)

    {
      submissions: rows.map { |submission| item_json(submission, latest_ids) },
      meta: { page: page, per_page: @per_page, total_count: total, total_pages: total_pages,
              has_next_page: page < total_pages, has_prev_page: page > 1 },
      previous: previous && item_json(previous, latest_ids),
      next: following && item_json(following, latest_ids),
      counts: counts,
      modules: module_options,
      students: student_options,
      module_grids: module_grids,
      github_sync_module_ids: github_sync_module_ids,
      lesson: lesson_json
    }
  end

  private

  def positive_id(value)
    number = Integer(value.to_s, 10, exception: false)
    number if number&.positive?
  end

  # The cohorts this request covers: the one named, or every cohort the viewer teaches.
  def scope_cohort_ids
    @scope_cohort_ids ||= @cohort ? [ @cohort.id ] : @viewer.accessible_cohorts.select(:id)
  end

  def base_scope
    Submission.where(enrollment_id: Enrollment.where(cohort_id: scope_cohort_ids).select(:id))
  end

  # Labels for a chosen filter come only from records inside the scope: a learner enrolled in
  # one of its cohorts, a module or lesson of a curriculum one of them uses. An id outside it
  # gets the same answer as an id that doesn't exist (no label), so it reveals nothing.
  def visible_curriculum_ids
    Cohort.where(id: scope_cohort_ids).select(:curriculum_id)
  end

  # The module, student and lesson filters, leaving out the ones named in `except`.
  def filtered_scope(except: [])
    scope = base_scope
    scope = scope.where(user_id: @student_id) if @student_id && !except.include?(:student)
    if @module_id && !except.include?(:module)
      scope = scope.where(content_block_id: ContentBlock.joins(:lesson).where(lessons: { module_id: @module_id }).select(:id))
    end
    scope = scope.where(content_block_id: ContentBlock.where(lesson_id: @lesson_id).select(:id)) if @lesson_id && !except.include?(:lesson)
    scope
  end

  def status_scope(scope, status = @status, apply_suggestion: true)
    result = case status
    when "ungraded" then scope.latest_attempts.where(grade: nil)
    when "redo" then scope.latest_attempts.where(grade: "R")
    else scope
    end
    apply_suggestion ? apply_suggestion_outcome(result, status: status) : result
  end

  def ordered(scope)
    direction = @newest ? "DESC" : "ASC"
    includes = [
      :user,
      { enrollment: [ { learner_extensions: :granted_by }, :learning_plan, { cohort: :cohort_module_submission_windows } ] }
    ]
    if school_suggestions_enabled?
      includes << :submission_grade_suggestion
      includes << { content_block: [ :active_exercise_check_policy, { lesson: { curriculum_module: :curriculum } } ] }
    else
      includes << { content_block: { lesson: { curriculum_module: :curriculum } } }
    end
    scope.includes(*includes)
      .order(Arel.sql("submissions.created_at #{direction}, submissions.id #{direction}"))
  end

  def status_counts
    scope = filtered_scope
    ungraded = status_scope(scope, "ungraded")
    { ungraded: ungraded.count, redo: status_scope(scope, "redo").count, all: status_scope(scope, "all").count }.tap do |counts|
      counts[:overdue] = overdue_count(ungraded) if review_targets.any?
    end
  end

  def review_targets
    @review_targets ||= if @cohort
      { @cohort.id => @cohort.review_sla_business_days }.compact
    else
      Cohort.where(id: scope_cohort_ids).where.not(review_sla_business_days: nil).pluck(:id, :review_sla_business_days).to_h
    end
  end

  def review_sla
    @review_sla ||= ReviewSla.new(holidays: SchoolSetting.current.review_sla_holidays)
  end

  def overdue_count(ungraded)
    groups = review_targets.group_by { |_, days| days }
    overdue = groups.map do |days, cohorts|
      cutoff = review_sla.overdue_submitted_before(business_days: days, now: @now)
      Enrollment.where(cohort_id: cohorts.map(&:first)).select(:id).then do |enrollment_ids|
        Submission.where(enrollment_id: enrollment_ids).where(created_at: ...cutoff)
      end
    end.reduce(&:or)
    ungraded.and(overdue).count
  end

  # The page that holds focus_id in this list, or nil when it isn't in it.
  def focused_page
    return nil unless @focus_id

    scope = status_scope(filtered_scope)
    focus = scope.where(id: @focus_id).pick(:created_at, :id)
    return nil unless focus

    comparison = @newest ? ">" : "<"
    before = scope.where("(submissions.created_at, submissions.id) #{comparison} (?, ?)", *focus).count
    (before / @per_page) + 1
  end

  # Modules with work in the chosen status, inside the student and lesson filters.
  # A chosen module with nothing left stays in the list (count 0), so the select keeps its value.
  def module_options
    counts = status_scope(filtered_scope(except: [ :module ]))
      .joins(content_block: { lesson: :curriculum_module })
      .group("modules.id", "modules.name", "modules.position")
      .count
    options = counts.map { |(id, name, position), count| { id: id, name: name, count: count, position: position.to_i } }
    if @module_id && options.none? { |option| option[:id] == @module_id }
      chosen = CurriculumModule.where(id: @module_id, curriculum_id: visible_curriculum_ids).pick(:id, :name, :position)
      options << { id: chosen[0], name: chosen[1], count: 0, position: chosen[2].to_i } if chosen
    end
    options.sort_by { |option| [ option[:position], option[:name].to_s, option[:id] ] }
      .map { |option| option.except(:position) }
  end

  # Students with work in the chosen status, inside the module and lesson filters.
  def student_options
    counts = status_scope(filtered_scope(except: [ :student ]))
      .joins(:user)
      .group("users.id", "users.first_name", "users.last_name", "users.email")
      .count
    options = counts.map { |(id, first, last, email), count| { id: id, name: display_name(first, last, email), count: count } }
    if @student_id && options.none? { |option| option[:id] == @student_id }
      chosen = User.where(id: @student_id).where(id: Enrollment.where(cohort_id: scope_cohort_ids).select(:user_id))
        .pick(:id, :first_name, :last_name, :email)
      options << { id: chosen[0], name: display_name(chosen[1], chosen[2], chosen[3]), count: 0 } if chosen
    end
    options.sort_by { |option| [ option[:name].downcase, option[:id] ] }
  end

  def display_name(first, last, email)
    [ first, last ].compact.join(" ").presence || email.to_s.split("@").first
  end

  # "Module grids": every cohort and module in scope with any submissions, and how many
  # latest attempts wait for review there. The filters don't apply.
  def module_grids
    group = [ "cohorts.id", "cohorts.name", "modules.id", "modules.name", "modules.position" ]
    grouped = ->(scope) { scope.joins(enrollment: :cohort).joins(content_block: { lesson: :curriculum_module }).group(*group) }
    waiting = grouped.call(status_scope(base_scope, "ungraded", apply_suggestion: false)).count
    grouped.call(base_scope).count.keys
      .sort_by { |cohort_id, cohort_name, module_id, module_name, position| [ cohort_name.to_s, position.to_i, module_name.to_s, cohort_id, module_id ] }
      .map do |key|
        cohort_id, cohort_name, module_id, module_name, = key
        { cohort_id: cohort_id, cohort_name: cohort_name, module_id: module_id, module_name: module_name, waiting: waiting.fetch(key, 0) }
      end
  end

  def github_sync_module_ids
    return [] unless @cohort && FeatureSwitches.for(cohort: @cohort)["github_sync"]

    modules = @cohort.curriculum.modules.order(:position, :id)
    modules = modules.where(id: @module_id) if @module_id
    configs = (@cohort.settings || {})["module_github_config"] || {}
    blocks_by_module = ContentBlock.joins(:lesson)
      .where(lessons: { module_id: modules.reorder(nil).select(:id), archived_at: nil, published: true })
      .where(block_type: [ :exercise, :code_challenge ])
      .where.not(filename: [ nil, "" ])
      .includes(lesson: :curriculum_module)
      .group_by { |block| block.lesson.module_id }
    modules.pluck(:id).select do |id|
      requires_github = configs.dig(id.to_s, "requires_github") == true
      blocks_by_module.fetch(id, []).any? { |block| block.github_sync_submission?(requires_github: requires_github) }
    end
  end

  def lesson_json
    return nil unless @lesson_id

    id, title = Lesson.joins(:curriculum_module).where(id: @lesson_id, modules: { curriculum_id: visible_curriculum_ids }).pick("lessons.id", "lessons.title")
    id ? { id: id, title: title } : nil
  end

  def extension_fields(enrollment, lesson)
    return {} unless enrollment && (enrollment.cohort.personal_pace? || enrollment.learner_extensions.any?(&:effective?))

    { extensions: @submission_windows.fetch(enrollment.id).matching_extensions(lesson).map(&:staff_json),
      submission_window: SubmissionWindowStatus.for_lesson(cohort: enrollment.cohort, lesson: lesson, enrollment: enrollment, context: @submission_windows[enrollment.id]) }
  end

  def item_json(submission, latest_ids)
    block = submission.content_block
    lesson = block.lesson
    cohort = submission.enrollment&.cohort
    {
      id: submission.id,
      enrollment_id: submission.enrollment_id,
      latest_submission_id: latest_ids[submission.attempt_key],
      content_block_id: submission.content_block_id,
      user_id: submission.user_id,
      user_name: submission.user.full_name,
      grade: submission.grade,
      grading_scale: lesson.curriculum_module.curriculum.grading_scale,
      graded_at: submission.graded_at,
      num_submissions: submission.num_submissions,
      created_at: submission.created_at,
      updated_at: submission.updated_at.iso8601(6),
      content_block_title: block.display_title(fallback: "Exercise"),
      content_block_type: block.block_type,
      lesson_id: lesson.id,
      lesson_title: lesson.title,
      module_id: lesson.module_id,
      module_name: lesson.curriculum_module.name,
      module_position: lesson.curriculum_module.position,
      cohort_id: cohort&.id,
      cohort_name: cohort&.name,
      course_delivery: cohort&.course_delivery,
      **extension_fields(submission.enrollment, lesson),
      **review_fields(submission, cohort, latest_ids),
      **grade_suggestion_fields(submission, cohort, block, latest_ids),
      week_number: cohort.nil? || cohort.self_paced? ? nil : SubmissionWindowStatus.week_number_for_release_day(lesson.release_day)
    }
  end

  def school_features
    @school_features ||= FeatureSwitches.school(read_only: true)
  end

  def school_suggestions_enabled?
    school_features["github_app"] == true && school_features["github_grade_suggestions"] == true
  end

  def suggestion_enabled_cohort_ids
    @suggestion_enabled_cohort_ids ||= begin
      return [] unless school_suggestions_enabled?

      cohorts = @cohort ? [ @cohort ] : @viewer.accessible_cohorts.select(:id, :settings).to_a
      cohorts.select { |cohort| GithubGradeSuggestionEvaluator.enabled_for?(cohort, school: school_features) }.map(&:id)
    end
  end

  # The last two lines: a suggested grade off the curriculum's current scale is out of date
  # (SubmissionGradeSuggestion#off_scale?); suggestion_curricula is joined in apply_suggestion_outcome.
  FRESH_SUGGESTION_SQL = Arel.sql(
    "submission_grade_suggestions.outcome <> 'stale_evidence' AND " \
    "((submission_grade_suggestions.exercise_check_policy_id IS NULL AND active_policies.id IS NULL) " \
    "OR (submission_grade_suggestions.exercise_check_policy_id IS NOT NULL " \
    "AND active_policies.id IS NOT NULL " \
    "AND active_policies.id = submission_grade_suggestions.exercise_check_policy_id " \
    "AND submission_grade_suggestions.policy_version IS NOT NULL " \
    "AND active_policies.version = submission_grade_suggestions.policy_version)) AND " \
    "(submission_grade_suggestions.commit_sha IS NULL OR submissions.commit_sha IS NULL " \
    "OR LOWER(submission_grade_suggestions.commit_sha) = LOWER(submissions.commit_sha)) AND " \
    "NOT (submission_grade_suggestions.outcome = 'suggest_b' AND suggestion_curricula.grading_scale <> 'letter_abc_redo') AND " \
    "NOT (submission_grade_suggestions.outcome = 'suggest_pass' AND suggestion_curricula.grading_scale <> 'pass_redo')"
  ).freeze

  def apply_suggestion_outcome(scope, status:)
    return scope unless @suggestion_outcome
    return scope.none if suggestion_enabled_cohort_ids.empty?

    enabled_enrollments = Enrollment.where(cohort_id: suggestion_enabled_cohort_ids).select(:id)
    suggestions = SubmissionGradeSuggestion
      .joins(:submission)
      .joins(
        "LEFT JOIN exercise_check_policies active_policies " \
        "ON active_policies.content_block_id = submission_grade_suggestions.content_block_id " \
        "AND active_policies.active = TRUE"
      )
      .joins(
        "JOIN content_blocks suggestion_blocks ON suggestion_blocks.id = submissions.content_block_id " \
        "JOIN lessons suggestion_lessons ON suggestion_lessons.id = suggestion_blocks.lesson_id " \
        "JOIN modules suggestion_modules ON suggestion_modules.id = suggestion_lessons.module_id " \
        "JOIN curricula suggestion_curricula ON suggestion_curricula.id = suggestion_modules.curriculum_id"
      )
      .where(enrollment_id: enabled_enrollments)

    matching = if @suggestion_outcome == "stale_evidence"
      stale = suggestions.where.not(FRESH_SUGGESTION_SQL)
      if status == "all"
        stale.or(suggestions.where.not(submission_id: base_scope.latest_attempts.select(:id)))
      else
        stale
      end
    else
      fresh = suggestions.where(outcome: @suggestion_outcome).where(FRESH_SUGGESTION_SQL)
      status == "all" ? fresh.where(submission_id: base_scope.latest_attempts.select(:id)) : fresh
    end

    scope.where(id: matching.select(:submission_id))
  end

  def grade_suggestion_fields(submission, cohort, block, latest_ids)
    return {} unless cohort && GithubGradeSuggestionEvaluator.enabled_for?(cohort, school: school_features)

    suggestion = submission.submission_grade_suggestion
    return {} unless suggestion

    {
      grade_suggestion: suggestion.to_staff_json(
        active_policy: block.active_exercise_check_policy,
        latest_submission_id: latest_ids[submission.attempt_key],
        submission_commit_sha: submission.commit_sha,
        grading_scale: block.lesson.curriculum_module.curriculum.grading_scale
      )
    }
  end

  def review_fields(submission, cohort, latest_ids)
    business_days = cohort&.review_sla_business_days
    return {} unless business_days && submission.grade.nil? && latest_ids[submission.attempt_key] == submission.id

    target = review_sla.call(submitted_at: submission.created_at, business_days: business_days, now: @now)
    { review_sla: target.except(:overdue_days) }
  end
end

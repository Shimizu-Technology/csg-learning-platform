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
    sort: "oldest", page: 1, per_page: PER_PAGE, focus_id: nil)
    @viewer = viewer
    @cohort = cohort
    @status = STATUSES.include?(status.to_s) ? status.to_s : "ungraded"
    @module_id = positive_id(module_id)
    @student_id = positive_id(student_id)
    @lesson_id = positive_id(lesson_id)
    @newest = sort.to_s == "newest"
    @per_page = positive_id(per_page)&.clamp(1, MAX_PER_PAGE) || PER_PAGE
    @page = positive_id(page) || 1
    @focus_id = positive_id(focus_id)
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

  def status_scope(scope, status = @status)
    case status
    when "ungraded" then scope.latest_attempts.where(grade: nil)
    when "redo" then scope.latest_attempts.where(grade: "R")
    else scope
    end
  end

  def ordered(scope)
    direction = @newest ? "DESC" : "ASC"
    scope.includes(:user, { enrollment: [ { learner_extensions: :granted_by }, :learning_plan, { cohort: :cohort_module_submission_windows } ] }, { content_block: { lesson: :curriculum_module } })
      .order(Arel.sql("submissions.created_at #{direction}, submissions.id #{direction}"))
  end

  def status_counts
    scope = filtered_scope
    { ungraded: status_scope(scope, "ungraded").count, redo: status_scope(scope, "redo").count, all: scope.count }
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
    waiting = grouped.call(status_scope(base_scope, "ungraded")).count
    grouped.call(base_scope).count.keys
      .sort_by { |cohort_id, cohort_name, module_id, module_name, position| [ cohort_name.to_s, position.to_i, module_name.to_s, cohort_id, module_id ] }
      .map do |key|
        cohort_id, cohort_name, module_id, module_name, = key
        { cohort_id: cohort_id, cohort_name: cohort_name, module_id: module_id, module_name: module_name, waiting: waiting.fetch(key, 0) }
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
      week_number: cohort.nil? || cohort.self_paced? ? nil : SubmissionWindowStatus.week_number_for_release_day(lesson.release_day)
    }
  end
end

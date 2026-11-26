# Batch review (GET /api/v1/submissions/batch_review): the ungraded latest
# attempts on one exercise, with the answer text, links, check config and
# grade suggestion each card needs, so an instructor can skim them and approve
# the passing ones together (SubmissionBatchGrade).
#
# Scope: the cohort named, or every cohort the viewer may see
# (StaffCohortScope). `exercises` lists the exercises with work waiting there,
# most waiting first, inside the optional module and lesson filters. The
# chosen exercise is `content_block_id` when given, otherwise the one with the
# most waiting. One exercise means one grading scale for every card.
class SubmissionBatchReview
  MAX_EXERCISES = 100

  def initialize(viewer:, cohort: nil, module_id: nil, lesson_id: nil, content_block_id: nil, school_features: FeatureSwitches.school(read_only: true))
    @viewer = viewer
    @cohort = cohort
    @module_id = positive_id(module_id)
    @lesson_id = positive_id(lesson_id)
    @content_block_id = positive_id(content_block_id)
    @school_features = school_features
    @scope = StaffCohortScope.new(viewer)
  end

  def as_json(*)
    options = exercise_options
    chosen_id = @content_block_id || options.first&.dig(:content_block_id)
    block = chosen_id && ContentBlock.includes(:rubric, lesson: { curriculum_module: :curriculum })
      .joins(lesson: :curriculum_module).where(modules: { curriculum_id: visible_curriculum_ids }).find_by(id: chosen_id)
    @block = block
    submissions = block ? ordered_submissions : []
    latest_ids = Submission.latest_attempt_ids_for(submissions)

    {
      exercises: options,
      exercise: block && exercise_json(block, options.find { |option| option[:content_block_id] == block.id }&.dig(:waiting) || 0),
      submissions: submissions.first(SubmissionBatchGrade::MAX_ITEMS).map { |submission| item_json(submission, latest_ids) },
      total_count: submissions.length,
      max_batch_size: SubmissionBatchGrade::MAX_ITEMS
    }
  end

  private

  def positive_id(value)
    number = Integer(value.to_s, 10, exception: false)
    number if number&.positive?
  end

  def scope_cohort_ids
    @scope_cohort_ids ||= @cohort ? [ @cohort.id ] : @scope.visible_cohorts.pluck(:id)
  end

  def visible_curriculum_ids
    Cohort.where(id: scope_cohort_ids).select(:curriculum_id)
  end

  def waiting_scope
    scope = Submission.where(enrollment_id: Enrollment.where(cohort_id: scope_cohort_ids).select(:id))
    scope = scope.where(content_block_id: ContentBlock.joins(:lesson).where(lessons: { module_id: @module_id }).select(:id)) if @module_id
    scope = scope.where(content_block_id: ContentBlock.where(lesson_id: @lesson_id).select(:id)) if @lesson_id
    scope.latest_attempts.where(grade: nil)
  end

  def exercise_options
    counts = waiting_scope.group(:content_block_id).count
    return [] if counts.empty?

    blocks = ContentBlock.includes(lesson: { curriculum_module: :curriculum }).where(id: counts.keys).index_by(&:id)
    counts.filter_map { |id, waiting| blocks[id] && exercise_json(blocks[id], waiting, summary: true) }
      .sort_by { |option| [ -option[:waiting], option[:module_position].to_i, option[:lesson_title].to_s, option[:content_block_id] ] }
      .first(MAX_EXERCISES)
  end

  def exercise_json(block, waiting, summary: false)
    lesson = block.lesson
    json = {
      content_block_id: block.id,
      title: block.display_title(fallback: "Exercise"),
      lesson_id: lesson.id,
      lesson_title: lesson.title,
      module_id: lesson.module_id,
      module_name: lesson.curriculum_module.name,
      module_position: lesson.curriculum_module.position,
      waiting: waiting,
      has_rubric: block.rubric_id.present?,
      grading_scale: lesson.curriculum_module.curriculum.grading_scale
    }
    return json if summary

    json.merge(
      submission_type: block.effective_submission_type,
      filename: block.filename,
      language_hint: block.metadata.is_a?(Hash) ? block.metadata["language"] : nil,
      submission_config: block.submission_config || {}
    )
  end

  # Oldest first, like the grading queue: the work that has waited longest.
  def ordered_submissions
    includes = [ :user, { enrollment: :cohort } ]
    includes << :submission_grade_suggestion if suggestions_possible?
    waiting_scope.where(content_block_id: @block.id).includes(*includes)
      .order(Arel.sql("submissions.created_at ASC, submissions.id ASC")).to_a
  end

  def suggestions_possible?
    @school_features["github_app"] == true && @school_features["github_grade_suggestions"] == true
  end

  def item_json(submission, latest_ids)
    cohort = submission.enrollment&.cohort
    json = {
      id: submission.id,
      enrollment_id: submission.enrollment_id,
      latest_submission_id: latest_ids[submission.attempt_key],
      user_id: submission.user_id,
      user_name: submission.user.full_name,
      cohort_id: cohort&.id,
      cohort_name: cohort&.name,
      num_submissions: submission.num_submissions,
      created_at: submission.created_at,
      updated_at: submission.updated_at.iso8601(6),
      submission_type: submission.submission_type.presence || @block.submission_type_for(submission.enrollment),
      text: submission.text,
      repo_url: submission.repo_url,
      github_code_url: submission.github_code_url,
      pr_url: submission.pr_url,
      live_url: submission.live_url,
      commit_sha: submission.commit_sha
    }
    suggestion = suggestions_possible? && cohort && GithubGradeSuggestionEvaluator.enabled_for?(cohort, school: @school_features) && submission.submission_grade_suggestion
    if suggestion
      json[:grade_suggestion] = suggestion.to_staff_json(
        active_policy: active_policy,
        latest_submission_id: latest_ids[submission.attempt_key],
        submission_commit_sha: submission.commit_sha,
        grading_scale: @block.lesson.curriculum_module.curriculum.grading_scale
      )
    end
    json
  end

  def active_policy
    return @active_policy if defined?(@active_policy)

    @active_policy = ExerciseCheckPolicy.active.find_by(content_block_id: @block.id)
  end
end

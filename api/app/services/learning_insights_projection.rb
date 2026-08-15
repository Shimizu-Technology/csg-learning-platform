class LearningInsightsProjection
  def initialize(cohort:, user_id: nil, now: Time.current)
    @cohort = cohort
    @user_id = user_id&.to_i
    @now = now
  end

  def call
    load_records
    objective_payloads = objectives.map { |objective| objective_json(objective) }
    status_counts = objective_payloads.flat_map { |objective| objective[:students] }.group_by { |student| student[:status] }

    {
      generated_at: now,
      evidence_scope: {
        kind: "curriculum",
        curriculum_id: cohort.curriculum_id,
        curriculum_name: cohort.curriculum.name,
        completion_and_watch_time_excluded: true
      },
      cohort: { id: cohort.id, name: cohort.name },
      summary: {
        objective_count: objectives.size,
        learner_count: enrollments.size,
        demonstrated_count: status_counts.fetch("demonstrated", []).size,
        developing_count: status_counts.fetch("developing", []).size,
        needs_revision_count: status_counts.fetch("needs_revision", []).size,
        not_evidenced_count: status_counts.fetch("not_evidenced", []).size,
        open_redo_count: current_submissions.count { |submission| submission.grade == "R" },
        revision_pattern_count: revision_patterns.size
      },
      rule: {
        version: "staff-evidence-v1",
        demonstrated: "Latest instructor-rated criterion meets or exceeds expectations, or latest aligned submission has a passing grade.",
        needs_revision: "Current aligned work has a redo grade or revision-level criterion.",
        developing: "Evidence exists, but it is retrieval-only, developing-level, or not yet instructor-confirmed.",
        not_evidenced: "No rubric, submission, or retrieval evidence is recorded for this objective.",
        automation_boundary: "Evidence status never changes grades, access, or progress automatically."
      },
      objectives: objective_payloads,
      revision_patterns: revision_patterns
    }
  end

  private

  attr_reader :cohort, :user_id, :now, :enrollments, :objectives, :blocks, :submissions,
              :current_submissions, :objective_block_ids, :evidence_by_objective_user

  def load_records
    @enrollments = cohort.enrollments.joins(:user).includes(:user).merge(User.not_archived).order(:id)
    @enrollments = @enrollments.where(user_id: user_id) if user_id.present?
    @enrollments = @enrollments.to_a
    user_ids = enrollments.map(&:user_id)

    @objectives = cohort.curriculum.learning_objectives.active.ordered.to_a
    objective_ids = objectives.map(&:id)
    @blocks = ContentBlock.joins(lesson: :curriculum_module)
      .where(modules: { curriculum_id: cohort.curriculum_id })
      .includes(lesson: :curriculum_module)
      .to_a
    block_ids = blocks.map(&:id)
    @blocks_by_id = blocks.index_by(&:id)

    @submissions = Submission.where(user_id: user_ids, content_block_id: block_ids)
      .includes(:user, :github_check_runs, :submission_criterion_results, content_block: { lesson: :curriculum_module })
      .order(:created_at, :id)
      .to_a
    @current_submissions = submissions.group_by { |submission| [ submission.user_id, submission.content_block_id ] }
      .values
      .map(&:last)
    @current_submissions_by_block_id = current_submissions.group_by(&:content_block_id)
    @current_submission_ids = current_submissions.index_by { |submission| [ submission.user_id, submission.content_block_id ] }.transform_values(&:id)
    @objective_block_ids = build_objective_block_ids(objective_ids)
    @objectives_by_block_id = Hash.new { |hash, key| hash[key] = [] }
    objective_block_ids.each { |objective_id, ids| ids.each { |block_id| @objectives_by_block_id[block_id] << objective_id } }
    @evidence_by_objective_user = Hash.new { |hash, key| hash[key] = [] }

    add_criterion_evidence(objective_ids, user_ids)
    add_aligned_submission_evidence
    add_knowledge_check_evidence(objective_ids, user_ids)
  end

  def build_objective_block_ids(objective_ids)
    blocks_by_lesson = blocks.group_by(&:lesson_id)
    map = ObjectiveAlignment.where(learning_objective_id: objective_ids).find_each.with_object(Hash.new { |hash, key| hash[key] = [] }) do |alignment, result|
      targets = alignment.content_block_id.present? ? [ alignment.content_block_id ] : blocks_by_lesson.fetch(alignment.lesson_id, []).map(&:id)
      result[alignment.learning_objective_id].concat(targets)
      result[alignment.learning_objective_id].uniq!
    end
    RubricCriterion.where(learning_objective_id: objective_ids).includes(rubric: :content_blocks).find_each do |criterion|
      map[criterion.learning_objective_id].concat(criterion.rubric.content_blocks.map(&:id))
      map[criterion.learning_objective_id].uniq!
    end
    map
  end

  def add_criterion_evidence(objective_ids, user_ids)
    results = SubmissionCriterionResult.joins(:rubric_criterion, :submission)
      .where(submissions: { user_id: user_ids }, rubric_criteria: { learning_objective_id: objective_ids })
      .includes(:rubric_criterion, submission: { content_block: { lesson: :curriculum_module } })

    results.find_each do |result|
      submission = result.submission
      objective_id = result.rubric_criterion.learning_objective_id
      @criterion_submission_keys ||= {}
      @criterion_submission_keys[[ objective_id, submission.id ]] = true
      add_evidence(objective_id, submission.user_id, {
        id: "criterion-#{result.id}",
        kind: "rubric_criterion",
        state: criterion_state(result.rating),
        label: result.rubric_criterion.title,
        value: result.rating,
        occurred_at: submission.graded_at || result.updated_at,
        submission_id: submission.id,
        content_block_id: submission.content_block_id,
        lesson_id: submission.content_block.lesson_id,
        module_id: submission.content_block.lesson.module_id,
        current_submission: current_submission?(submission),
        github_checks: github_check_summary(submission)
      })
    end
  end

  def add_aligned_submission_evidence
    submissions.each do |submission|
      @objectives_by_block_id.fetch(submission.content_block_id, []).each do |objective_id|
        next if @criterion_submission_keys&.key?([ objective_id, submission.id ])
        next if submission.grade.blank?

        add_evidence(objective_id, submission.user_id, {
          id: "submission-#{submission.id}",
          kind: "aligned_submission",
          state: submission.grade == "R" ? "needs_revision" : "demonstrated",
          label: submission.content_block.title.presence || submission.content_block.lesson.title,
          value: submission.grade,
          occurred_at: submission.graded_at || submission.updated_at,
          submission_id: submission.id,
          content_block_id: submission.content_block_id,
          lesson_id: submission.content_block.lesson_id,
          module_id: submission.content_block.lesson.module_id,
          current_submission: current_submission?(submission),
          github_checks: github_check_summary(submission)
        })
      end
    end
  end

  def add_knowledge_check_evidence(objective_ids, user_ids)
    attempts = KnowledgeCheckAttempt.joins(:knowledge_check)
      .where(user_id: user_ids, knowledge_checks: { learning_objective_id: objective_ids })
      .includes(knowledge_check: { content_block: { lesson: :curriculum_module } })
      .order(:created_at, :id)
      .to_a
    attempts.group_by { |attempt| [ attempt.user_id, attempt.knowledge_check_id ] }.each_value do |group|
      attempt = group.last
      check = attempt.knowledge_check
      add_evidence(check.learning_objective_id, attempt.user_id, {
        id: "knowledge-check-#{attempt.id}",
        kind: "knowledge_check",
        state: attempt.correct? ? "retrieval_confirmed" : "developing",
        label: check.content_block.title.presence || check.content_block.lesson.title,
        value: attempt.correct? ? "correct" : "incorrect",
        occurred_at: attempt.created_at,
        knowledge_check_id: check.id,
        attempt_id: attempt.id,
        attempt_count: group.size,
        content_block_id: check.content_block_id,
        lesson_id: check.content_block.lesson_id,
        module_id: check.content_block.lesson.module_id,
        current_submission: false,
        github_checks: nil
      })
    end
  end

  def objective_json(objective)
    students = enrollments.map do |enrollment|
      evidence = evidence_by_objective_user.fetch([ objective.id, enrollment.user_id ], []).sort_by { |item| item[:occurred_at] || Time.zone.at(0) }.reverse
      {
        enrollment_id: enrollment.id,
        user: { id: enrollment.user_id, full_name: enrollment.user.full_name, email: enrollment.user.email },
        status: evidence_status(evidence),
        evidence_count: evidence.size,
        last_evidence_at: evidence.first&.dig(:occurred_at),
        evidence: evidence
      }
    end
    counts = students.group_by { |student| student[:status] }
    demonstrated = counts.fetch("demonstrated", []).size
    {
      id: objective.id,
      code: objective.code,
      title: objective.title,
      description: objective.description,
      success_criteria: objective.success_criteria,
      demonstrated_count: demonstrated,
      learner_count: students.size,
      demonstrated_percentage: students.any? ? (demonstrated.to_f / students.size * 100).round(1) : 0,
      status_counts: {
        demonstrated: demonstrated,
        developing: counts.fetch("developing", []).size,
        needs_revision: counts.fetch("needs_revision", []).size,
        not_evidenced: counts.fetch("not_evidenced", []).size
      },
      students: students
    }
  end

  def revision_patterns
    @revision_patterns ||= @current_submissions_by_block_id.filter_map do |_block_id, group|
      block = group.first.content_block
      records = group.filter_map do |candidate|
        checks = github_check_summary(candidate)
        next unless candidate.grade == "R" || candidate.num_submissions.to_i > 1 || checks[:failed].positive?

        {
          submission_id: candidate.id,
          user: { id: candidate.user_id, full_name: candidate.user.full_name },
          grade: candidate.grade,
          attempt_count: candidate.num_submissions,
          github_checks: checks,
          updated_at: candidate.updated_at
        }
      end
      next if records.empty?
      redo_count = group.count { |candidate| candidate.grade == "R" }
      {
        content_block: { id: block.id, title: block.title.presence || block.lesson.title },
        lesson: { id: block.lesson_id, title: block.lesson.title },
        module: { id: block.lesson.module_id, name: block.lesson.curriculum_module.name },
        objective_ids: @objectives_by_block_id.fetch(block.id, []).uniq,
        learners_with_work: group.size,
        affected_learner_count: records.size,
        open_redo_count: redo_count,
        redo_percentage: group.any? ? (redo_count.to_f / group.size * 100).round(1) : 0,
        repeat_attempt_count: group.count { |candidate| candidate.num_submissions.to_i > 1 },
        failed_check_count: group.sum { |candidate| github_check_summary(candidate)[:failed] },
        records: records.sort_by { |record| record[:updated_at] || Time.zone.at(0) }.reverse
      }
    end.sort_by { |pattern| [ -pattern[:open_redo_count], -pattern[:failed_check_count], -pattern[:repeat_attempt_count], pattern.dig(:content_block, :title).to_s ] }
  end

  def add_evidence(objective_id, user_id, evidence)
    evidence_by_objective_user[[ objective_id, user_id ]] << evidence
  end

  def criterion_state(rating)
    return "demonstrated" if %w[exceeds meets].include?(rating)
    return "needs_revision" if rating == "redo"

    "developing"
  end

  def evidence_status(evidence)
    return "not_evidenced" if evidence.empty?
    return "needs_revision" if evidence.any? { |item| item[:current_submission] && item[:state] == "needs_revision" }

    instructor_evidence = evidence.find { |item| %w[rubric_criterion aligned_submission].include?(item[:kind]) }
    return instructor_evidence[:state] if instructor_evidence

    "developing"
  end

  def current_submission?(submission)
    @current_submission_ids[[ submission.user_id, submission.content_block_id ]] == submission.id
  end

  def github_check_summary(submission)
    runs = submission.github_check_runs.select { |run| run.head_sha == submission.commit_sha }
    {
      total: runs.size,
      passed: runs.count(&:passed?),
      failed: runs.count(&:failed?),
      pending: runs.count(&:pending?)
    }
  end
end

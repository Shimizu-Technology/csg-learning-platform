# The lesson payload the lesson page and staff editors read (LessonDetail in
# docs/openapi.json). Shared by the lessons controller and the block editor so
# both return the same wire shape.
module LessonSerialization
  extend ActiveSupport::Concern

  private

  def lesson_json(lesson, include_content: false, progress_map: {}, submission_map: {}, knowledge_check_attempt_map: {})
    requires_github = false
    json = {
      id: lesson.id,
      curriculum_id: lesson.curriculum_module.curriculum_id,
      module_id: lesson.module_id,
      title: lesson.title,
      lesson_type: lesson.lesson_type,
      position: lesson.position,
      release_day: lesson.release_day,
      required: lesson.required,
      archived_at: lesson.archived_at,
      updated_at: lesson.updated_at.iso8601(6),
      content_blocks_count: lesson.content_blocks.size
    }

    json[:objectives] = objective_json(lesson, include_inactive: current_user.staff?)

    if current_user.student?
      enrollment = @lesson_enrollment || current_user.enrollments.active
        .joins(:cohort)
        .includes(cohort: :cohort_module_submission_windows)
        .where(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
        .where(params[:cohort_id].present? ? { cohort_id: params[:cohort_id] } : {})
        .order(enrolled_at: :desc, id: :desc).first
      if enrollment
        cohort = enrollment.cohort
        json[:required] = enrollment.lesson_required?(lesson)
        json[:cohort_id] = cohort.id
        json[:capabilities] = EnrollmentCapabilities.for(enrollment)
        reviewer = MyWork.reviewer_for(cohort)
        json[:reviewer] = reviewer && { id: reviewer.id, full_name: reviewer.full_name }
        mod_gh = (cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}
        requires_github = mod_gh["requires_github"] || false
        json[:requires_github] = requires_github
        json[:repository_name] = mod_gh["repository_name"].presence || cohort.repository_name
        json[:submission_window] = SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson)
      end
    end

    json[:requires_submission] = lesson.effective_requires_submission(requires_github: requires_github, feature_cohort: @lesson_enrollment&.cohort)
    json[:submission_type] = lesson.effective_submission_type(requires_github: requires_github, feature_cohort: @lesson_enrollment&.cohort)

    if include_content
      # Staff see attempt counts from the cohorts they may see (StaffCohortScope); nil counts every attempt.
      @staff_attempt_enrollments = current_user.staff? ? cohort_scope.enrollment_ids(lesson.curriculum_module.curriculum_id)&.pluck(:id)&.to_set : nil
      completion_block_ids = lesson.completion_block_ids.to_set
      json[:content_blocks] = lesson.content_blocks.map { |cb|
        submission_type = cb.effective_submission_type(requires_github: requires_github, feature_cohort: @lesson_enrollment&.cohort)
        block = {
          id: cb.id,
          block_type: cb.block_type,
          position: cb.position,
          title: cb.title,
          body: cb.body,
          video_url: cb.video_url,
          s3_video_key: cb.s3_video_key,
          filename: cb.filename,
          effective_submission_type: submission_type,
          submission_type: submission_type,
          submission_type_explicit: cb.submission_type,
          submission_config: cb.submission_config || {},
          metadata: cb.metadata,
          has_s3_video: cb.s3_video_key.present?,
          completion_required: completion_block_ids.include?(cb.id),
          objective_ids: lesson.objective_alignments.select { |alignment| alignment.content_block_id == cb.id }
            .map(&:learning_objective_id),
          rubric: rubric_json(cb.rubric, submission_map[cb.id]&.first),
          knowledge_check: current_user.staff? || FeatureSwitches.for(cohort: @lesson_enrollment&.cohort)["knowledge_checks"] ? knowledge_check_json(cb.knowledge_check, knowledge_check_attempt_map) : nil
        }

        if current_user.staff?
          block[:s3_video_content_type] = cb.s3_video_content_type
          block[:s3_video_size] = cb.s3_video_size
          block[:s3_video_uploaded_at] = cb.s3_video_uploaded_at
          block[:s3_video_uploaded_by] = cb.s3_video_uploaded_by&.full_name
        end

        # Include solution only for staff
        block[:solution] = cb.solution if current_user.staff?

        # Include progress for students
        if progress_map[cb.id]
          p = progress_map[cb.id]
          block[:progress] = {
            status: p.status,
            completed_at: p.completed_at,
            video_last_position: p.video_last_position,
            video_total_watched: p.video_total_watched
          }
        end

        # Include submissions for students
        if submission_map[cb.id]
          block[:submissions] = submission_map[cb.id].map { |s|
            {
              id: s.id,
              submission_type: s.submission_type.presence || cb.effective_submission_type(requires_github: requires_github, feature_cohort: @lesson_enrollment&.cohort),
              text: s.text,
              grade: s.grade,
              feedback: s.feedback,
              graded_at: s.graded_at,
              # Who reviewed it, so feedback names the person (S-8); only an id and a name.
              grader: s.grader && { id: s.grader.id, full_name: s.grader.full_name },
              github_issue_url: s.github_issue_url,
              github_code_url: s.github_code_url,
              repo_url: s.repo_url,
              pr_url: s.pr_url,
              live_url: s.live_url,
              branch: s.branch,
              commit_sha: s.commit_sha,
              notes: s.notes,
              num_submissions: s.num_submissions,
              created_at: s.created_at,
              updated_at: s.updated_at
            }
          }
        end

        block
      }

      # Match the course outline: lessons run by release day, then position.
      # Positions repeat across days, so ordering by position alone shuffles them.
      sibling_lessons = Lesson.active.where(module_id: lesson.module_id).ordered.to_a
      current_index = sibling_lessons.index { |l| l.id == lesson.id }

      if current_index && !current_user.staff?
        # The outline's previous and next lessons the learner can open,
        # and where the lesson stands, from the one shared definition.
        progress = @lesson_enrollment && LearnerProgress.new(@lesson_enrollment)
        if progress
          available_siblings = progress.content.lessons_for(lesson.curriculum_module).select { |l| progress.available?(l) }
          avail_index = available_siblings.index { |l| l.id == lesson.id }
          prev_lesson = avail_index && avail_index > 0 ? available_siblings[avail_index - 1] : nil
          next_lesson = avail_index && avail_index < available_siblings.size - 1 ? available_siblings[avail_index + 1] : nil
          current = progress.lessons.find { |l| l.id == lesson.id }
          current_progress = current && progress.lesson_progress(current)
          json[:learner_status] = current_progress&.status
          # Handed-in steps (done or waiting for review) out of the lesson's
          # steps: the count Today and Learn show for this lesson.
          json[:completed_blocks] = current_progress&.completed_blocks
          json[:total_blocks] = current_progress&.total_blocks
          next_step = progress.next_lesson
          json[:next_step] = next_step && { id: next_step.id, title: next_step.title, module_id: next_step.module_id }
        else
          prev_lesson = nil
          next_lesson = nil
        end
      elsif current_index
        prev_lesson = current_index > 0 ? sibling_lessons[current_index - 1] : nil
        next_lesson = current_index < sibling_lessons.size - 1 ? sibling_lessons[current_index + 1] : nil
      end

      # Archived lessons aren't in the outline, so they get explicit empty navigation.
      json[:prev_lesson] = prev_lesson ? { id: prev_lesson.id, title: prev_lesson.title } : nil
      json[:next_lesson] = next_lesson ? { id: next_lesson.id, title: next_lesson.title } : nil
    end

    json
  end

  def objective_json(lesson, include_inactive: false)
    alignments = lesson.objective_alignments.includes(:learning_objective, :content_block).ordered
    alignments = alignments.select { |alignment| alignment.learning_objective.active? } unless include_inactive
    alignments.map do |alignment|
      objective = alignment.learning_objective
      {
        alignment_id: alignment.id,
        id: objective.id,
        code: objective.code,
        title: objective.title,
        description: objective.description,
        success_criteria: objective.success_criteria,
        active: objective.active,
        content_block_id: alignment.content_block_id,
        content_block_title: alignment.content_block&.title
      }
    end
  end

  def rubric_json(rubric, submission = nil)
    return nil unless rubric&.active? || (rubric && current_user.staff?)

    results = submission&.submission_criterion_results&.index_by(&:rubric_criterion_id) || {}
    {
      id: rubric.id,
      title: rubric.title,
      description: rubric.description,
      criteria: rubric.rubric_criteria.ordered.map do |criterion|
        result = results[criterion.id]
        {
          id: criterion.id,
          title: criterion.title,
          description: criterion.description,
          objective_code: criterion.learning_objective&.code,
          rating: result&.rating,
          feedback: result&.feedback
        }
      end
    }
  end

  # The cohorts this staff member may see on a curriculum (L-3.2): others are never counted.
  def cohort_scope
    @cohort_scope ||= StaffCohortScope.new(current_user)
  end

  def staff_attempt_count(check)
    return check.attempts.size if @staff_attempt_enrollments.nil?

    check.attempts.count { |attempt| @staff_attempt_enrollments.include?(attempt.enrollment_id) }
  end

  def knowledge_check_json(check, attempt_map)
    return nil unless check

    attempt_info = attempt_map[check.id] || {}
    attempt = attempt_info[:attempt]
    json = {
      id: check.id,
      prompt: check.prompt,
      options: check.options,
      objective_code: check.learning_objective&.code,
      attempt_count: current_user.staff? ? staff_attempt_count(check) : attempt_info[:count].to_i,
      latest_attempt: attempt ? {
        id: attempt.id,
        selected_option: attempt.selected_option,
        correct: attempt.correct,
        correct_option: check.correct_option,
        explanation: check.explanation,
        created_at: attempt.created_at
      } : nil
    }
    if current_user.staff?
      json[:correct_option] = check.correct_option
      json[:explanation] = check.explanation
      json[:learning_objective_id] = check.learning_objective_id
    end
    json
  end
end

class RecordDetail
  # A rubric (L-5.2): its curriculum, its criteria with the objective each one
  # checks, and the exercises (lesson and block) that are graded with it, like
  # the curriculum page's rubric list (RecordUsage#rubrics). Any staff member
  # can read a curriculum's content; the cohorts using it follow
  # StaffCohortScope: the instructor's own by name, the rest as a number.
  class RubricPage < Base
    private

    # Content isn't cohort-scoped: every staff member may open a rubric that exists.
    def authorized?
      Rubric.exists?(id: @id)
    end

    def build
      rubric = Rubric.includes(:curriculum).find(@id)
      curriculum = rubric.curriculum
      criteria = RubricCriterion.where(rubric_id: rubric.id).includes(:learning_objective).order(:position, :id).to_a
      blocks = ContentBlock.where(rubric_id: rubric.id).includes(lesson: :curriculum_module)
        .joins(lesson: :curriculum_module)
        .order("modules.position", "lessons.release_day", "lessons.position", "content_blocks.position", "content_blocks.id").to_a
      visible_ids = scope.visible_ids(curriculum.id)
      cohorts = Cohort.where(id: visible_ids).order(:start_date, :id).to_a
      graded = graded_counts(blocks.map(&:id), curriculum.id)

      {
        type: "rubric",
        id: rubric.id,
        title: rubric.title,
        description: rubric.description,
        active: rubric.active,
        curriculum: names.ref(curriculum),
        can_edit: LessonEditAccess.for(@viewer, curriculum).can_edit?,
        criteria: criteria.map do |criterion|
          objective = criterion.learning_objective
          { id: criterion.id, title: criterion.title, description: criterion.description,
            objective: objective && { id: objective.id, code: objective.code, title: objective.title } }
        end,
        uses: blocks.map do |block|
          lesson = block.lesson
          { lesson: { id: lesson.id, title: lesson.title, archived: lesson.archived? },
            module: { id: lesson.curriculum_module.id, name: lesson.curriculum_module.name },
            block: { id: block.id, title: block.title, block_type: block.block_type },
            graded: graded.fetch(block.id, 0) }
        end,
        cohorts: cohorts.map { |cohort| cohort_json(cohort) },
        other_cohorts_count: scope.other_count(curriculum.id)
      }
    end

    # Graded latest attempts per exercise, in the cohorts the viewer may count.
    def graded_counts(block_ids, curriculum_id)
      return {} if block_ids.empty?

      submissions = Submission.where(content_block_id: block_ids).latest_attempts.where.not(grade: nil)
      enrollments = scope.enrollment_ids(curriculum_id)
      submissions = submissions.where(enrollment_id: enrollments) if enrollments
      submissions.group(:content_block_id).count
    end
  end
end

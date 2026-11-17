class RecordDetail
  # A learner's plan for one enrollment (L-5.2): the student and cohort, the
  # plan's dates, its milestones with each lesson and where the student stands
  # on it (LearnerProgress, the one status source), and its revisions: who
  # saved it, when, and which parts changed. Editing stays in the plan editor
  # on the student page (#285).
  class LearningPlanPage < Base
    REVISIONS_SHOWN = 20
    # The parts of a revision staff recognize, in the order the editor shows them.
    FIELD_LABELS = {
      "title" => "title", "description" => "description", "active" => "on or off", "target_date" => "target date",
      "next_check_in_on" => "next check-in", "milestones" => "milestones", "lesson_overrides" => "lesson exceptions"
    }.freeze

    private

    def cohort_id_for(id)
      LearningPlan.joins(:enrollment).where(id: id).pick("enrollments.cohort_id")
    end

    def build
      plan = LearningPlan.includes(enrollment: [ :user, :cohort ]).find(@id)
      enrollment = plan.enrollment
      cohort = enrollment.cohort
      milestones = Array(plan.milestones).select { |item| item.is_a?(Hash) }
      lesson_ids = milestones.flat_map { |item| Array(item["lesson_ids"]) }.grep(Integer).uniq
      lessons = lesson_states(enrollment, lesson_ids)
      # One more than shown, so the oldest shown revision can say what it changed.
      revisions = plan.revisions.includes(:author).order(id: :desc).limit(REVISIONS_SHOWN + 1).to_a

      {
        type: "learning_plan",
        id: plan.id,
        title: plan.title,
        description: plan.description,
        active: plan.active,
        target_date: plan.target_date&.iso8601,
        next_check_in_on: plan.next_check_in_on&.iso8601,
        updated_at: iso(plan.updated_at),
        cohort: cohort_json(cohort),
        student: person(enrollment.user),
        enrollment_status: enrollment.status,
        lesson_exceptions_count: Array(plan.lesson_overrides).size,
        milestones: milestones.map do |item|
          rows = Array(item["lesson_ids"]).grep(Integer).filter_map { |lesson_id| lessons[lesson_id] }
          { title: item["title"].to_s, due_on: item["due_on"].presence, lessons: rows, completed_count: rows.count { |row| row[:completed] } }
        end,
        revisions_count: plan.revisions.count,
        revisions: revisions.first(REVISIONS_SHOWN).each_with_index.map do |revision, index|
          previous = revisions[index + 1]
          { id: revision.id, author: person(revision.author), created_at: iso(revision.created_at), changes: changes(revision.snapshot, previous&.snapshot) }
        end
      }
    end

    # Each milestone lesson with its title and the student's status. A lesson
    # no longer assigned keeps its title and has no status.
    def lesson_states(enrollment, lesson_ids)
      return {} if lesson_ids.empty?

      content = AssignedLearningContent.new(enrollment)
      progress = LearnerProgress.new(enrollment, content: content)
      assigned = content.modules.flat_map { |mod| content.lessons_for(mod).map { |lesson| [ lesson, mod ] } }.to_h { |lesson, mod| [ lesson.id, [ lesson, mod ] ] }
      missing = Lesson.where(id: lesson_ids - assigned.keys).pluck(:id, :title).to_h
      lesson_ids.each_with_object({}) do |lesson_id, rows|
        if assigned.key?(lesson_id)
          lesson, mod = assigned[lesson_id]
          answer = progress.lesson_progress(lesson)
          rows[lesson_id] = { id: lesson.id, title: lesson.title, module_id: mod.id, module_name: mod.name, status: answer.status, completed: answer.completed, assigned: true }
        elsif missing.key?(lesson_id)
          rows[lesson_id] = { id: lesson_id, title: missing[lesson_id], module_id: nil, module_name: nil, status: nil, completed: false, assigned: false }
        end
      end
    end

    # The parts that differ from the revision before (all of them for the first).
    def changes(snapshot, previous)
      return [ "created" ] unless previous.is_a?(Hash)
      return [] unless snapshot.is_a?(Hash)

      FIELD_LABELS.filter_map { |field, label| label if snapshot[field] != previous[field] }
    end
  end
end

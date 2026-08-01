class HelpRequestContext
  Result = Data.define(:cohort, :context_type, :context_source, :context_id, :label, :path)

  class InvalidContext < StandardError; end

  def self.resolve!(student:, cohort_id:, context_type:, context_id:, context_source: "primary")
    new(
      student: student,
      cohort_id: cohort_id,
      context_type: context_type,
      context_id: context_id,
      context_source: context_source
    ).resolve!
  end

  def initialize(student:, cohort_id:, context_type:, context_id:, context_source:)
    @student = student
    @cohort_id = cohort_id.to_i
    @context_type = context_type.to_s
    @context_id = Integer(context_id, exception: false)
    @context_source = context_source.to_s.presence || "primary"
  end

  def resolve!
    raise InvalidContext, "Invalid help-request context" unless HelpRequest.context_types.key?(@context_type)
    raise InvalidContext, "Invalid help-request source" unless HelpRequest.context_sources.key?(@context_source)
    raise InvalidContext, "Invalid help-request context" unless @context_id && @context_id >= 0

    enrollment = @student.enrollments.active.includes(:module_assignments, :lesson_assignments, cohort: :curriculum).find_by(cohort_id: @cohort_id)
    raise InvalidContext, "You do not have access to this cohort" unless enrollment

    case @context_type
    when "lesson" then resolve_lesson(enrollment)
    when "exercise" then resolve_exercise(enrollment)
    when "recording" then resolve_recording(enrollment)
    else raise InvalidContext, "Invalid help-request context"
    end
  end

  private

  def resolve_lesson(enrollment)
    reject_legacy!
    lesson = Lesson.includes(:curriculum_module).find_by(id: @context_id)
    authorize_lesson!(enrollment, lesson)
    Result.new(cohort: enrollment.cohort, context_type: "lesson", context_source: "primary", context_id: lesson.id, label: lesson.title, path: "/lessons/#{lesson.id}")
  end

  def resolve_exercise(enrollment)
    reject_legacy!
    block = ContentBlock.includes(lesson: :curriculum_module).find_by(id: @context_id)
    raise InvalidContext, "This exercise is not available" unless block&.exercise_like?

    authorize_lesson!(enrollment, block.lesson)
    Result.new(cohort: enrollment.cohort, context_type: "exercise", context_source: "primary", context_id: block.id, label: block.title.presence || block.lesson.title, path: "/lessons/#{block.lesson_id}")
  end

  def resolve_recording(enrollment)
    if @context_source == "legacy"
      recording = Array((enrollment.cohort.settings || {})["recordings"])[@context_id]
      raise InvalidContext, "This recording is not available" unless recording

      return Result.new(cohort: enrollment.cohort, context_type: "recording", context_source: "legacy", context_id: @context_id, label: recording["title"].presence || "Class recording", path: "/recordings")
    end

    recording = enrollment.cohort.recordings.find_by(id: @context_id)
    raise InvalidContext, "This recording is not available" unless recording

    Result.new(cohort: enrollment.cohort, context_type: "recording", context_source: "primary", context_id: recording.id, label: recording.title, path: "/recordings")
  end

  def authorize_lesson!(enrollment, lesson)
    raise InvalidContext, "This lesson is not available" unless lesson&.curriculum_module&.curriculum_id == enrollment.cohort.curriculum_id

    module_assignment = enrollment.module_assignments.find { |assignment| assignment.module_id == lesson.module_id }
    lesson_assignment = enrollment.lesson_assignments.find { |assignment| assignment.lesson_id == lesson.id }
    allowed = (module_assignment&.accessible?(enrollment.cohort) || lesson_assignment.present?) && lesson.available?(enrollment.cohort, module_assignment, lesson_assignment)
    raise InvalidContext, "This lesson is not available" unless allowed
  end

  def reject_legacy!
    raise InvalidContext, "Invalid help-request source" if @context_source == "legacy"
  end
end

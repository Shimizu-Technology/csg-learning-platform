# Can a learner open a lesson? The one rule behind GET /api/v1/lessons/:id,
# shared with anything else that would show a learner a lesson's title or link
# (message sources, L-1.8). Staff can always read lessons.
#
# The learner needs a readable enrollment in a cohort on the lesson's
# curriculum (the given cohort when `cohort_id` is set, otherwise their active
# one), the lesson's module or the lesson itself assigned to that enrollment,
# and the lesson released for them.
class LessonReadAccess
  Result = Data.define(:enrollment, :error) do
    def allowed? = error.nil?
  end

  NOT_ACCESSIBLE = "Cannot access this lesson".freeze
  NOT_UNLOCKED = "Lesson is not unlocked yet".freeze

  def self.check(user, lesson, cohort_id: nil)
    new(user, lesson, cohort_id: cohort_id).check
  end

  def self.allowed?(user, lesson, cohort_id: nil)
    check(user, lesson, cohort_id: cohort_id).allowed?
  end

  def initialize(user, lesson, cohort_id: nil)
    @user = user
    @lesson = lesson
    @cohort_id = cohort_id
  end

  def check
    return Result.new(enrollment: nil, error: NOT_ACCESSIBLE) unless @user && @lesson
    return Result.new(enrollment: nil, error: nil) if @user.staff?
    return denied if @lesson.archived?

    enrollment = readable_enrollment
    return denied unless enrollment

    assignment = enrollment.module_assignments.find_by(module_id: @lesson.module_id)
    lesson_assignment = enrollment.lesson_assignments.find_by(lesson_id: @lesson.id)
    return denied(enrollment) unless assignment&.accessible?(enrollment.cohort) || lesson_assignment.present?
    return Result.new(enrollment: enrollment, error: nil) if enrollment.lesson_available_for_read?(@lesson, assignment, lesson_assignment)

    Result.new(enrollment: enrollment, error: NOT_UNLOCKED)
  end

  private

  def denied(enrollment = nil)
    Result.new(enrollment: enrollment, error: NOT_ACCESSIBLE)
  end

  def readable_enrollment
    enrollments = @user.enrollments
      .joins(:cohort)
      .includes(:module_assignments, cohort: [ :cohort_module_schedules, :cohort_module_submission_windows ])
      .where(cohorts: { curriculum_id: @lesson.curriculum_module&.curriculum_id })
    enrollments = if @cohort_id.present?
      enrollments.with_read_access.where(cohort_id: @cohort_id)
    else
      enrollments.active
    end
    enrollments.order(enrolled_at: :desc, id: :desc).first
  end
end

# Which cohorts on a curriculum a staff member may see by name and in counts
# (L-3.2 privacy rule).
#
# - Admins see every cohort.
# - Instructors see the cohorts they teach. Other cohorts sharing the
#   curriculum are only a number (`other_count`), never named, and their
#   learners' work is never counted.
#
# `enrollment_ids` is nil when nothing is hidden (admins, and instructors who
# teach every cohort on the curriculum), so callers count everything as before
# (including legacy rows without an enrollment). Otherwise it is a subquery of
# the visible cohorts' enrollments to filter work by.
#
# At most two queries per curriculum, none repeated: memoized per instance.
class StaffCohortScope
  def initialize(viewer)
    @viewer = viewer
    @by_curriculum = {}
  end

  def admin?
    @viewer&.admin? && !@viewer.archived?
  end

  # A relation for staff workspaces spanning more than one curriculum.
  # The same taught ids as split/visible?, loaded once for the whole payload.
  def visible_cohorts
    admin? ? Cohort.all : Cohort.where(id: taught_cohort_ids)
  end

  # Cohort ids on the curriculum, split into [visible, hidden].
  def split(curriculum_id)
    @by_curriculum[curriculum_id] ||= begin
      all = Cohort.where(curriculum_id: curriculum_id).order(:start_date, :id).pluck(:id)
      visible = admin? ? all : all & taught_cohort_ids
      [ visible, all - visible ]
    end
  end

  def visible_ids(curriculum_id) = split(curriculum_id).first
  def other_count(curriculum_id) = split(curriculum_id).last.size
  def visible?(cohort_id) = admin? || taught_cohort_ids.include?(cohort_id)

  # Enrollment filter for counting work on this curriculum, or nil for "count everything".
  def enrollment_ids(curriculum_id)
    return nil if other_count(curriculum_id).zero?

    Enrollment.where(cohort_id: visible_ids(curriculum_id)).select(:id)
  end

  private

  def taught_cohort_ids
    @taught_cohort_ids ||= @viewer&.instructor? && !@viewer.archived? ? @viewer.cohort_instructor_assignments.pluck(:cohort_id) : []
  end
end

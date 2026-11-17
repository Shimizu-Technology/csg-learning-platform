class RecordDetail
  # Shared helpers for the record pages. Subclasses implement `cohort_id_for`
  # (the record's cohort from its id alone, or nil when it has none or doesn't
  # exist) and `build` (the payload, once authorized).
  class Base
    def initialize(viewer:, id:, now:)
      @viewer = viewer
      @id = id
      @now = now
    end

    def call
      return nil unless authorized?

      build
    end

    private

    # Staff may open a record in a cohort they can see (admins: all).
    def authorized?
      cohort_id = cohort_id_for(@id)
      cohort_id.present? && scope.visible?(cohort_id)
    end

    def scope
      @scope ||= StaffCohortScope.new(@viewer)
    end

    def names
      @names ||= CurriculumName.new(@viewer)
    end

    def admin?
      scope.admin?
    end

    def cohort_json(cohort)
      cohort && { id: cohort.id, name: cohort.name, course_delivery: cohort.course_delivery, status: cohort.effective_status }
    end

    def person(user)
      user && { id: user.id, name: user.full_name }
    end

    # Week n of a live program for a date, or nil (self-paced, undated, before the start).
    def program_week(cohort, date)
      return nil if cohort.self_paced? || cohort.start_date.nil? || date.nil?

      number = (date.to_date - cohort.start_date).to_i.div(7) + 1
      number.positive? ? number : nil
    end

    def iso(time)
      time&.iso8601
    end
  end
end

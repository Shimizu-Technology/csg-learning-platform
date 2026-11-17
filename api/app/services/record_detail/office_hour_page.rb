class RecordDetail
  # An office-hour or live-class session (L-5.2): its cohort, time and repeat,
  # the next few times it meets, who scheduled it, the cohort's teaching team
  # and who is invited, with the Join link. The app doesn't record who
  # attended, so the page says who is invited (the cohort's active learners).
  class OfficeHourPage < Base
    UPCOMING = 3

    private

    def cohort_id_for(id)
      OfficeHour.where(id: id).pick(:cohort_id)
    end

    def build
      office_hour = OfficeHour.includes(:created_by, :cohort).find(@id)
      cohort = office_hour.cohort
      team = cohort.instructors.not_archived.order(:first_name, :last_name, :id).to_a

      {
        type: "office_hour",
        id: office_hour.id,
        title: office_hour.title,
        description: office_hour.description,
        event_kind: office_hour.event_kind,
        recurrence: office_hour.recurrence,
        active: office_hour.active,
        starts_at: iso(office_hour.starts_at),
        ends_at: iso(office_hour.ends_at),
        timezone: office_hour.timezone,
        meeting_url: office_hour.meeting_url,
        upcoming: office_hour.upcoming_occurrences(limit: UPCOMING, from: @now).map { |time| { starts_at: iso(time[:starts_at]), ends_at: iso(time[:ends_at]) } },
        cohort: cohort_json(cohort),
        scheduled_by: person(office_hour.created_by),
        teaching_team: team.map { |user| person(user) },
        invited_count: Enrollment.active.where(cohort_id: cohort.id).count,
        can_edit: @viewer.can_teach_cohort?(cohort)
      }
    end
  end
end

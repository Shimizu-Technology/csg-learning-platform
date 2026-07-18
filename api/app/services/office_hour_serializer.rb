class OfficeHourSerializer
  class << self
    def active_for(cohort)
      if cohort.office_hours.loaded?
        cohort.office_hours.select(&:active?).sort_by(&:starts_at)
      else
        cohort.office_hours.active.ordered.includes(:created_by).to_a
      end
    end

    def collection_json(office_hours, occurrence_limit: 3, upcoming_limit: 3)
      expansion_limit = [ occurrence_limit, upcoming_limit ].max
      occurrences_by_office_hour = office_hours.to_h do |office_hour|
        [ office_hour, office_hour.upcoming_occurrences(limit: expansion_limit) ]
      end

      {
        office_hours: office_hours.map do |office_hour|
          as_json(
            office_hour,
            occurrence_limit: occurrence_limit,
            occurrences: occurrences_by_office_hour.fetch(office_hour)
          )
        end,
        upcoming: upcoming(
          office_hours,
          limit: upcoming_limit,
          occurrences_by_office_hour: occurrences_by_office_hour
        )
      }
    end

    def as_json(office_hour, occurrence_limit: 3, occurrences: nil)
      occurrences ||= office_hour.upcoming_occurrences(limit: occurrence_limit)

      {
        id: office_hour.id,
        cohort_id: office_hour.cohort_id,
        title: office_hour.title,
        description: office_hour.description,
        starts_at: office_hour.starts_at,
        ends_at: office_hour.ends_at,
        meeting_url: office_hour.meeting_url,
        timezone: office_hour.timezone,
        recurrence: office_hour.recurrence,
        active: office_hour.active,
        occurrences: occurrences.first(occurrence_limit).map do |occurrence|
          occurrence_json(office_hour, occurrence)
        end,
        created_by: office_hour.created_by && {
          id: office_hour.created_by.id,
          full_name: office_hour.created_by.full_name,
          email: office_hour.created_by.email
        }
      }
    end

    def upcoming(office_hours, limit: 3, occurrences_by_office_hour: nil)
      office_hours.flat_map do |office_hour|
        occurrences = if occurrences_by_office_hour
          occurrences_by_office_hour.fetch(office_hour)
        else
          office_hour.upcoming_occurrences(limit: limit)
        end

        occurrences.first(limit).map do |occurrence|
          occurrence_json(office_hour, occurrence)
        end
      end.sort_by { |occurrence| occurrence[:starts_at] }.first(limit)
    end

    def occurrence_json(office_hour, occurrence)
      {
        office_hour_id: office_hour.id,
        title: office_hour.title,
        description: office_hour.description,
        starts_at: occurrence[:starts_at],
        ends_at: occurrence[:ends_at],
        meeting_url: office_hour.meeting_url,
        timezone: office_hour.timezone,
        recurrence: office_hour.recurrence
      }
    end
  end
end

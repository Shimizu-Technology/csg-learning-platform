class LearningCalendar
  TIMEZONE = Rails.application.config.x.school.time_zone

  class << self
    def time_zone
      Rails.application.config.x.school.time_zone
    end

    def today(at: Time.current)
      at.in_time_zone(time_zone).to_date
    end
  end
end

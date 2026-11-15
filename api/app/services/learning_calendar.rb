class LearningCalendar
  TIMEZONE = Rails.application.config.x.school.time_zone

  class << self
    def today(at: Time.current)
      at.in_time_zone(TIMEZONE).to_date
    end
  end
end

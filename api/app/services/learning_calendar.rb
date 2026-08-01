class LearningCalendar
  TIMEZONE = "Pacific/Guam".freeze

  class << self
    def today(at: Time.current)
      at.in_time_zone(TIMEZONE).to_date
    end
  end
end

# Boot-time school calendar configuration. Keep Rails' global UTC default.
module SchoolTime
  def self.configure(value = ENV["SCHOOL_TIME_ZONE"].presence || "Pacific/Guam")
    zone = TZInfo::Timezone.get(value)
    { time_zone: zone.identifier, time_zone_label: label(zone) }
  rescue TZInfo::InvalidTimezoneIdentifier
    raise ArgumentError, "Invalid SCHOOL_TIME_ZONE: #{value.inspect}; use an IANA timezone such as Pacific/Guam"
  end

  def self.business_day_location
    zone = Rails.application.config.x.school.time_zone
    zone == "Pacific/Guam" ? "Guam" : zone.split("/").last.tr("_", " ")
  end

  def self.label(zone, at: Time.current)
    return "ChST" if zone.identifier == "Pacific/Guam"

    zone.period_for_utc(at.utc).abbreviation.to_s
  end
end

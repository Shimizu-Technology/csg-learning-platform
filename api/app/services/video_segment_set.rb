class VideoSegmentSet
  MAX_SEGMENTS = 40
  MAX_LABEL_LENGTH = 120

  def self.normalize(raw_segments)
    segments = Array(raw_segments)
    raise ArgumentError, "A recording can have at most #{MAX_SEGMENTS} sections" if segments.length > MAX_SEGMENTS

    segments.map.with_index do |raw, index|
      segment = raw.respond_to?(:to_h) ? raw.to_h.stringify_keys : {}
      label = segment["label"].to_s.strip
      start_seconds = Integer(segment["start_seconds"].to_s, 10)
      end_seconds = Integer(segment["end_seconds"].to_s, 10)

      raise ArgumentError, "Recording section #{index + 1} needs a label" if label.blank?
      raise ArgumentError, "Recording section #{index + 1} label is too long" if label.length > MAX_LABEL_LENGTH
      raise ArgumentError, "Recording section #{index + 1} must start at zero or later" if start_seconds.negative?
      raise ArgumentError, "Recording section #{index + 1} must end after it starts" if end_seconds <= start_seconds

      {
        "label" => label,
        "start_seconds" => start_seconds,
        "end_seconds" => end_seconds,
        "required" => ActiveModel::Type::Boolean.new.cast(segment.fetch("required", true))
      }
    rescue ArgumentError => error
      raise error if error.message.start_with?("Recording section")

      raise ArgumentError, "Recording section #{index + 1} timestamps must be whole seconds"
    end.sort_by { |segment| segment["start_seconds"] }
  end
end

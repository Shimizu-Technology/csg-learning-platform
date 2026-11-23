class VideoSegmentSet
  CURRENT_VERSION = 2
  MAX_SEGMENTS = 40
  MAX_LABEL_LENGTH = 120
  MAX_SAFE_SECONDS = (2**53) - 1

  def self.validate_authoring_shape!(payload)
    return unless payload.key?(:video_segments)

    segments = payload[:video_segments]
    unless segments.is_a?(Array) && segments.all? { |row| row.is_a?(Hash) || row.is_a?(ActionController::Parameters) }
      raise ArgumentError, "Recording sections must be a list of sections with a start and end"
    end
  end

  def self.normalize_for_authoring(segments)
    validate_authoring_shape!(video_segments: segments)
    segments.each_with_index do |segment, index|
      values = segment.to_h.stringify_keys
      %w[start_seconds end_seconds].each do |field|
        raw = values[field].to_s
        next if raw.match?(/\A[0-9]+\z/) && raw.to_i <= MAX_SAFE_SECONDS

        raise ArgumentError, "Recording section #{index + 1} #{field.delete_suffix('_seconds')} must be a non-negative whole number of seconds"
      end
    end
    normalize(segments)
  end

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

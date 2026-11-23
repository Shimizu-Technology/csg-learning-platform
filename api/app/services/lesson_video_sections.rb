# Section ids are timestamp pairs. Labels and Core/Optional edits preserve
# credit for the same footage. Hosted versions with different files have
# separate checks, even when the editor declares an equivalent timeline.
class LessonVideoSections
  def initialize(block)
    @block = block
  end

  def sources
    @sources ||= playback_sources
  end

  def includes_source?(source)
    active_sources.include?(source)
  end

  def completed(progress)
    allowed = ranges.keys
    progress.completed_video_sections.slice(*active_sources).filter_map do |source, keys|
      current = keys & allowed
      [ source, current ] if current.present?
    end.to_h
  end

  def record(progress, source:, reported:, reported_total:, duration:)
    return {} unless includes_source?(source) && reported.is_a?(Array) && reported.size <= VideoSegmentSet::MAX_SEGMENTS

    current = progress.completed_video_sections
    credited = current.fetch(source, [])
    credited_core = credited.select do |key|
      finish = core_ranges.dig(key, 0)
      finish && (!duration&.positive? || finish <= duration)
    end
    accepted = []
    rejected = []
    missing_credit = 0
    reported.uniq.each do |key|
      next unless key.is_a?(String)

      finish, required, length = ranges[key]
      next if finish && credited.include?(key)

      minimum = if required
        core_minimum(credited_core + [ key ])
      elsif length
        range_minimum(length)
      end
      if !finish || reported_total < minimum || (duration&.positive? && finish > duration)
        rejected << key
      elsif !duration&.positive?
        missing_credit = [ missing_credit, 1 ].max
      elsif progress.video_total_watched < minimum
        missing_credit = [ missing_credit, minimum - progress.video_total_watched ].max
      else
        accepted << key
        credited_core << key if required
      end
    end

    progress.completed_video_sections = current.merge(source => (credited | accepted)) if accepted.any?
    {}.tap do |result|
      result[:section_rejected_ranges] = rejected if rejected.any?
      if missing_credit.positive?
        result[:section_retry_after_seconds] = (missing_credit / WatchCredit::REFILL_RATE).ceil
      end
    end
  end

  def core?
    core_ranges.any?
  end

  def core_complete?(progress, duration:)
    return false unless duration&.positive? && core? && core_ranges.values.all? { |end_seconds, _| end_seconds <= duration }

    keys = core_ranges.keys
    completed(progress).values.any? { |credited| (keys - credited).empty? } &&
      progress.video_total_watched >= core_minimum(keys)
  end

  private

  def range_minimum(length)
    # Integer transport plus limited keyframe/sample loss, capped at five seconds.
    [ length - (length * 0.02).clamp(1, 5), 1 ].max.ceil
  end

  def core_minimum(keys)
    spans = keys.map do |key|
      finish, _, length = core_ranges.fetch(key)
      [ finish, finish - length ]
    end

    # Allocate the minimum for each range from its right edge. Visiting
    # earliest finishes first maximizes reuse by all later overlapping ranges.
    covered = []
    spans.sort.each do |finish, start|
      within = covered.filter_map do |left, right|
        [ [ start, left ].max, right ] if right > start
      end
      needed = range_minimum(finish - start) - within.sum { |left, right| right - left }
      cursor = finish
      within.reverse_each do |left, right|
        break unless needed.positive?

        take = [ cursor - right, needed ].min
        covered << [ cursor - take, cursor ] if take.positive?
        needed -= take
        cursor = left
      end
      covered << [ cursor - needed, cursor ] if needed.positive?
      covered.sort!
    end
    covered.sum { |left, right| right - left }
  end

  def playback_sources
    return {} unless @block.video? || @block.recording?

    if @block.s3_video_key.present?
      versions = @block.video_versions
      default = versions.first&.fetch("s3_video_key") || @block.s3_video_key
      {
        "default" => source_id("hosted", default),
        "versions" => versions.to_h { |version| [ version.fetch("id"), source_id("hosted", version.fetch("s3_video_key")) ] }
      }
    elsif supported_link?(@block.video_url)
      { "default" => source_id("linked", @block.video_url) }
    else
      {}
    end
  end

  def supported_link?(value)
    url = URI.parse(value.to_s)
    return false unless url.is_a?(URI::HTTPS)

    host = url.host.to_s.downcase
    parts = url.path.to_s.split("/").reject(&:empty?)
    if host.delete_prefix("www.").delete_prefix("m.") == "youtu.be"
      return parts.first&.match?(/\A[A-Za-z0-9_-]{6,20}\z/)
    end
    if host == "youtube.com" || host.end_with?(".youtube.com") || host == "youtube-nocookie.com" || host.end_with?(".youtube-nocookie.com")
      candidate = URI.decode_www_form(url.query.to_s).assoc("v")&.last.presence
      candidate ||= parts[1] if %w[embed shorts live].include?(parts.first)
      return candidate&.match?(/\A[A-Za-z0-9_-]{6,20}\z/)
    end
    if host == "vimeo.com" || host.end_with?(".vimeo.com")
      candidate = case parts.first
      when "video" then parts[1]
      when "channels" then parts[2]
      else parts.first
      end
      return candidate&.match?(/\A[0-9]+\z/)
    end
    false
  rescue URI::InvalidURIError, ArgumentError
    false
  end

  def active_sources
    @active_sources ||= [ sources["default"], *sources.fetch("versions", {}).values ].compact.uniq
  end

  def source_id(kind, asset)
    # Opaque to students, and stable across signed URL refreshes and block copies.
    Digest::SHA256.hexdigest([ kind, asset ].to_json)
  end

  def ranges
    @ranges ||= VideoSegmentSet.normalize(@block.metadata.to_h["video_segments"]).each_with_object({}) do |segment, result|
      key = "#{segment.fetch("start_seconds")}:#{segment.fetch("end_seconds")}"
      result[key] = [
        segment.fetch("end_seconds"),
        segment.fetch("required") || result.dig(key, 1),
        segment.fetch("end_seconds") - segment.fetch("start_seconds")
      ]
    end
  rescue ArgumentError, TypeError
    @ranges = {}
  end

  def core_ranges
    @core_ranges ||= ranges.select { |_key, (_end, required)| required }
  end
end

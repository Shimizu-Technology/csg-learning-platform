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
    return unless includes_source?(source) && reported.is_a?(Array) && reported.size <= VideoSegmentSet::MAX_SEGMENTS
    return unless duration&.positive?

    watched = [ progress.video_total_watched, reported_total ].min
    accepted = reported.select do |key|
      next false unless key.is_a?(String) && ranges.key?(key)

      finish, _required, length = ranges.fetch(key)
      # A section report also needs player-reported watch time accepted by
      # WatchCredit. Allow one second for the whole-second transport.
      finish <= duration && watched >= [ length - 1, 1 ].max
    end
    return if accepted.empty?

    current = progress.completed_video_sections
    progress.completed_video_sections = current.merge(source => (current.fetch(source, []) | accepted))
  end

  def core?
    core_ranges.any?
  end

  def core_complete?(progress, duration:)
    return false unless duration&.positive? && core? && core_ranges.values.all? { |end_seconds, _| end_seconds <= duration }

    completed(progress).values.any? { |keys| (core_ranges.keys - keys).empty? }
  end

  private

  def playback_sources
    return {} unless @block.video? || @block.recording?

    if @block.s3_video_key.present?
      versions = @block.video_versions
      default = versions.first&.fetch("s3_video_key") || @block.s3_video_key
      {
        "default" => source_id("hosted", default),
        "versions" => versions.to_h { |version| [ version.fetch("id"), source_id("hosted", version.fetch("s3_video_key")) ] }
      }
    elsif %w[youtube vimeo].include?(Recording.source_kind_for(@block.video_url))
      { "default" => source_id("linked", @block.video_url) }
    else
      {}
    end
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

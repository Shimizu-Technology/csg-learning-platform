class VoiceAudioInspection
  class InvalidAudio < StandardError; end

  MAX_BYTES = 6.megabytes
  MAX_DURATION_SECONDS = 300.0
  DURATION_TOLERANCE_SECONDS = 0.5
  MP4_CONTENT_TYPES = %w[audio/mp4 audio/m4a audio/x-m4a].freeze
  WEBM_CONTENT_TYPES = %w[audio/webm].freeze
  OGG_CONTENT_TYPES = %w[audio/ogg].freeze
  CONTAINER_BOXES = %w[moov trak mdia minf stbl].freeze

  EBML_MAGIC = "\x1A\x45\xDF\xA3".b.freeze
  OGG_MAGIC = "OggS".b.freeze
  WEBM_SEGMENT_ID = 0x18538067
  WEBM_INFO_ID = 0x1549A966
  WEBM_CLUSTER_ID = 0x1F43B675
  WEBM_TIMECODE_SCALE_ID = 0x2AD7B1
  WEBM_DURATION_ID = 0x4489
  DEFAULT_WEBM_TIMECODE_SCALE = 1_000_000
  MAX_EBML_ELEMENTS = 64

  def self.call(upload, duration_seconds: nil)
    new(upload, duration_seconds: duration_seconds).call
  end

  def initialize(upload, duration_seconds: nil)
    @upload = upload
    @reported_duration_seconds = duration_seconds
  end

  def call
    format = detect_format
    raise InvalidAudio, "The recording is empty." unless @upload.size.to_i.positive?
    raise InvalidAudio, "The recording is too large." if @upload.size.to_i > MAX_BYTES

    @upload.tempfile.binmode if @upload.tempfile.respond_to?(:binmode)
    bytes = @upload.tempfile.read.to_s.b
    @upload.tempfile.rewind
    raise InvalidAudio, "The recording is empty." unless bytes.bytesize.positive?
    raise InvalidAudio, "The recording is too large." if bytes.bytesize > MAX_BYTES

    case format
    when :mp4
      inspect_mp4(bytes)
    when :webm
      inspect_webm(bytes)
    when :ogg
      inspect_ogg(bytes)
    end
  end

  private

  def detect_format
    base_type = @upload.content_type.to_s.split(";").first.to_s.strip.downcase
    extension = File.extname(@upload.original_filename.to_s).downcase

    return :mp4 if MP4_CONTENT_TYPES.include?(base_type) || (base_type == "application/octet-stream" && %w[.m4a .mp4].include?(extension))
    return :webm if WEBM_CONTENT_TYPES.include?(base_type) || (base_type == "application/octet-stream" && extension == ".webm")
    return :ogg if OGG_CONTENT_TYPES.include?(base_type) || (base_type == "application/octet-stream" && extension == ".ogg")

    raise InvalidAudio, "Choose an M4A, WebM, or Ogg recording."
  end

  def inspect_mp4(bytes)
    raise InvalidAudio, "The recording is not a valid M4A file." unless bytes.bytesize >= 12 && bytes.byteslice(4, 4) == "ftyp".b

    duration = movie_duration(bytes)
    validate_duration!(duration)

    { duration_seconds: duration.round(1), content_type: "audio/mp4", extension: "m4a" }
  end

  def inspect_webm(bytes)
    raise InvalidAudio, "The recording is not a valid WebM file." unless bytes.bytesize >= 4 && bytes.byteslice(0, 4) == EBML_MAGIC

    container_duration = webm_duration(bytes)
    duration = container_duration ? validate_duration!(container_duration) : fallback_duration!

    { duration_seconds: duration.round(1), content_type: "audio/webm", extension: "webm" }
  end

  def inspect_ogg(bytes)
    raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.bytesize >= 4 && bytes.byteslice(0, 4) == OGG_MAGIC

    duration = fallback_duration!

    { duration_seconds: duration.round(1), content_type: "audio/ogg", extension: "ogg" }
  end

  def fallback_duration!
    validate_duration!(parse_reported_duration(@reported_duration_seconds))
  end

  def parse_reported_duration(value)
    return nil if value.nil? || value == ""

    parsed = Float(value, exception: false)
    parsed&.finite? ? parsed : nil
  end

  def validate_duration!(duration)
    raise InvalidAudio, "The recording duration could not be verified." unless duration.is_a?(Numeric) && duration.to_f.finite? && duration.to_f.positive?
    raise InvalidAudio, "Recordings must be 5 minutes or shorter." if duration.to_f > MAX_DURATION_SECONDS + DURATION_TOLERANCE_SECONDS

    duration.to_f
  end

  def movie_duration(bytes)
    each_box(bytes, 0, bytes.bytesize) do |type, payload_start, box_end|
      next unless type == "mvhd".b

      version = bytes.getbyte(payload_start)
      if version == 0 && payload_start + 20 <= box_end
        timescale = bytes.byteslice(payload_start + 12, 4).unpack1("N")
        duration = bytes.byteslice(payload_start + 16, 4).unpack1("N")
      elsif version == 1 && payload_start + 32 <= box_end
        timescale = bytes.byteslice(payload_start + 20, 4).unpack1("N")
        duration = bytes.byteslice(payload_start + 24, 8).unpack1("Q>")
      end
      return duration.to_f / timescale if timescale.to_i.positive?
    end
    nil
  end

  def each_box(bytes, start_at, end_at, depth = 0, &block)
    offset = start_at
    while offset + 8 <= end_at
      size = bytes.byteslice(offset, 4).unpack1("N")
      type = bytes.byteslice(offset + 4, 4)
      header_size = 8
      if size == 1
        break if offset + 16 > end_at
        size = bytes.byteslice(offset + 8, 8).unpack1("Q>")
        header_size = 16
      elsif size == 0
        size = end_at - offset
      end
      break if size < header_size || offset + size > end_at

      payload_start = offset + header_size
      box_end = offset + size
      yield type, payload_start, box_end
      each_box(bytes, payload_start, box_end, depth + 1, &block) if depth < 8 && CONTAINER_BOXES.include?(type)
      offset = box_end
    end
  end

  def webm_duration(bytes)
    offset = 0
    limit = bytes.bytesize
    steps = 0

    while offset < limit && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, limit)
      break unless id

      size, payload_start = read_ebml_size(bytes, after_id, limit)
      break if size.nil?

      if id == WEBM_SEGMENT_ID
        segment_end = size == :unknown ? limit : [ payload_start + size, limit ].min
        return parse_webm_segment(bytes, payload_start, segment_end)
      end

      break if size == :unknown

      offset = payload_start + size
    end
    nil
  end

  def parse_webm_segment(bytes, start_at, end_at)
    offset = start_at
    steps = 0

    while offset < end_at && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      break unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      break if size.nil?

      if id == WEBM_INFO_ID
        info_end = size == :unknown ? end_at : [ payload_start + size, end_at ].min
        return parse_webm_info(bytes, payload_start, info_end)
      end

      break if id == WEBM_CLUSTER_ID || size == :unknown

      offset = payload_start + size
    end
    nil
  end

  def parse_webm_info(bytes, start_at, end_at)
    timecode_scale = DEFAULT_WEBM_TIMECODE_SCALE
    duration_ticks = nil
    offset = start_at
    steps = 0

    while offset < end_at && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      break unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      break if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_TIMECODE_SCALE_ID && size.between?(1, 8)
        timecode_scale = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_DURATION_ID
        if size == 4
          duration_ticks = bytes.byteslice(payload_start, 4).unpack1("g")
        elsif size == 8
          duration_ticks = bytes.byteslice(payload_start, 8).unpack1("G")
        end
      end

      offset = payload_start + size
    end

    return nil unless duration_ticks&.finite? && duration_ticks.positive? && timecode_scale.positive?

    (duration_ticks * timecode_scale) / 1_000_000_000.0
  end

  def read_ebml_id(bytes, offset, limit)
    return [ nil, offset ] if offset >= limit

    first = bytes.getbyte(offset)
    length = vint_length(first, max_length: 4)
    return [ nil, offset ] unless length && offset + length <= limit

    value = 0
    length.times { |index| value = (value << 8) | bytes.getbyte(offset + index) }
    [ value, offset + length ]
  end

  def read_ebml_size(bytes, offset, limit)
    return [ nil, offset ] if offset >= limit

    first = bytes.getbyte(offset)
    length = vint_length(first, max_length: 8)
    return [ nil, offset ] unless length && offset + length <= limit

    mask = (1 << (8 - length)) - 1
    value = first & mask
    (1...length).each { |index| value = (value << 8) | bytes.getbyte(offset + index) }
    unknown = value == ((1 << (7 * length)) - 1)
    [ unknown ? :unknown : value, offset + length ]
  end

  def vint_length(byte, max_length:)
    return nil if byte.nil? || byte.zero?

    (1..max_length).each do |length|
      return length if (byte & (1 << (8 - length))) != 0
    end
    nil
  end

  def read_uint_be(bytes, offset, length)
    value = 0
    length.times { |index| value = (value << 8) | bytes.getbyte(offset + index) }
    value
  end
end

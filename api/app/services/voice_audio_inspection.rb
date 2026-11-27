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
  WEBM_EBML_HEADER_ID = 0x1A45DFA3
  WEBM_DOCTYPE_ID = 0x4282
  WEBM_SEGMENT_ID = 0x18538067
  WEBM_INFO_ID = 0x1549A966
  WEBM_CLUSTER_ID = 0x1F43B675
  WEBM_CLUSTER_TIMESTAMP_ID = 0xE7
  WEBM_SIMPLE_BLOCK_ID = 0xA3
  WEBM_BLOCK_GROUP_ID = 0xA0
  WEBM_BLOCK_ID = 0xA1
  WEBM_TIMECODE_SCALE_ID = 0x2AD7B1
  WEBM_DURATION_ID = 0x4489
  DEFAULT_WEBM_TIMECODE_SCALE = 1_000_000
  ALLOWED_WEBM_DOCTYPES = %w[webm matroska].freeze
  MAX_EBML_ELEMENTS = 4_096
  MAX_OGG_PAGES = 16_384
  OPUS_GRANULE_RATE = 48_000.0

  def self.call(upload, duration_seconds: nil)
    new(upload).call
  end

  def initialize(upload)
    @upload = upload
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

    duration = webm_duration!(bytes)
    validate_duration!(duration)

    { duration_seconds: duration.round(1), content_type: "audio/webm", extension: "webm" }
  end

  def inspect_ogg(bytes)
    raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.bytesize >= 27 && bytes.byteslice(0, 4) == OGG_MAGIC

    duration = ogg_duration!(bytes)
    validate_duration!(duration)

    { duration_seconds: duration.round(1), content_type: "audio/ogg", extension: "ogg" }
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

  def webm_duration!(bytes)
    limit = bytes.bytesize
    header_id, after_id = read_ebml_id(bytes, 0, limit)
    raise InvalidAudio, "The recording is not a valid WebM file." unless header_id == WEBM_EBML_HEADER_ID

    header_size, header_start = read_ebml_size(bytes, after_id, limit)
    if header_size.nil? || header_size == :unknown || header_start + header_size > limit
      raise InvalidAudio, "The recording is not a valid WebM file."
    end

    header_end = header_start + header_size
    doctype = parse_ebml_doctype!(bytes, header_start, header_end)
    raise InvalidAudio, "The recording is not a valid WebM file." unless ALLOWED_WEBM_DOCTYPES.include?(doctype)

    offset = header_end
    steps = 0
    while offset < limit && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_el = read_ebml_id(bytes, offset, limit)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_el, limit)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil?

      if id == WEBM_SEGMENT_ID
        if size != :unknown && payload_start + size > limit
          raise InvalidAudio, "The recording is not a valid WebM file."
        end
        segment_end = size == :unknown ? limit : payload_start + size
        return parse_webm_segment!(bytes, payload_start, segment_end)
      end

      raise InvalidAudio, "The recording is not a valid WebM file." if size == :unknown || payload_start + size > limit
      offset = payload_start + size
    end

    raise InvalidAudio, "The recording is not a valid WebM file."
  end

  def parse_ebml_doctype!(bytes, start_at, end_at)
    offset = start_at
    doctype = nil
    steps = 0
    while offset < end_at && steps < 64
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_DOCTYPE_ID
        doctype = bytes.byteslice(payload_start, size).delete("\x00".b).downcase
      end
      offset = payload_start + size
    end
    doctype
  end

  def parse_webm_segment!(bytes, start_at, end_at)
    offset = start_at
    steps = 0
    info_parsed = false
    timecode_scale = DEFAULT_WEBM_TIMECODE_SCALE
    info_duration_ticks = nil
    min_ts = nil
    max_ts = nil
    has_audio_block = false

    while offset < end_at && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil?
      if size != :unknown && payload_start + size > end_at
        raise InvalidAudio, "The recording is not a valid WebM file."
      end

      element_end = size == :unknown ? end_at : payload_start + size

      if id == WEBM_INFO_ID
        info_parsed = true
        timecode_scale, info_duration_ticks = parse_webm_info!(bytes, payload_start, element_end)
        return (info_duration_ticks * timecode_scale) / 1_000_000_000.0 if info_duration_ticks
      elsif id == WEBM_CLUSTER_ID
        cluster_min, cluster_max, cluster_blocks, next_offset = parse_webm_cluster!(bytes, payload_start, element_end, unknown_size: size == :unknown)
        if cluster_min && cluster_max
          min_ts = min_ts ? [ min_ts, cluster_min ].min : cluster_min
          max_ts = max_ts ? [ max_ts, cluster_max ].max : cluster_max
        end
        has_audio_block ||= cluster_blocks
        offset = next_offset
        next
      elsif size == :unknown
        raise InvalidAudio, "The recording is not a valid WebM file."
      end

      offset = element_end
    end

    raise InvalidAudio, "The recording is not a valid WebM file." unless info_parsed
    return nil unless has_audio_block && min_ts && max_ts && timecode_scale.positive?

    span_seconds = ((max_ts - min_ts) * timecode_scale) / 1_000_000_000.0
    span_seconds.positive? ? span_seconds : 0.1
  end

  def parse_webm_info!(bytes, start_at, end_at)
    timecode_scale = DEFAULT_WEBM_TIMECODE_SCALE
    duration_ticks = nil
    offset = start_at
    steps = 0

    while offset < end_at && steps < 64
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_TIMECODE_SCALE_ID && size.between?(1, 8)
        timecode_scale = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_DURATION_ID
        if size == 4
          duration_ticks = bytes.byteslice(payload_start, 4).unpack1("g")
        elsif size == 8
          duration_ticks = bytes.byteslice(payload_start, 8).unpack1("G")
        else
          raise InvalidAudio, "The recording is not a valid WebM file."
        end
      end

      offset = payload_start + size
    end

    valid_duration = duration_ticks&.finite? && duration_ticks.positive? && timecode_scale.positive? ? duration_ticks : nil
    [ timecode_scale, valid_duration ]
  end

  def parse_webm_cluster!(bytes, start_at, end_at, unknown_size: false)
    offset = start_at
    cluster_ts = nil
    min_ts = nil
    max_ts = nil
    has_block = false
    steps = 0

    while offset < end_at && steps < MAX_EBML_ELEMENTS
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      # Unknown-size Cluster ends when the next top-level Segment child begins.
      if unknown_size && [ WEBM_CLUSTER_ID, WEBM_INFO_ID, 0x1654AE6B, 0x1C53BB6B, 0x1254C367, 0x114D9B74 ].include?(id)
        return [ min_ts, max_ts, has_block, offset ]
      end

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_CLUSTER_TIMESTAMP_ID && size.between?(1, 8)
        cluster_ts = read_uint_be(bytes, payload_start, size)
        min_ts = min_ts ? [ min_ts, cluster_ts ].min : cluster_ts
        max_ts = max_ts ? [ max_ts, cluster_ts ].max : cluster_ts
      elsif id == WEBM_SIMPLE_BLOCK_ID && size >= 4
        rel = read_block_relative_timestamp(bytes, payload_start, payload_start + size)
        if cluster_ts && rel
          abs = cluster_ts + rel
          min_ts = min_ts ? [ min_ts, abs ].min : abs
          max_ts = max_ts ? [ max_ts, abs ].max : abs
          has_block = true
        end
      elsif id == WEBM_BLOCK_GROUP_ID
        rel = parse_block_group_relative_timestamp!(bytes, payload_start, payload_start + size)
        if cluster_ts && rel
          abs = cluster_ts + rel
          min_ts = min_ts ? [ min_ts, abs ].min : abs
          max_ts = max_ts ? [ max_ts, abs ].max : abs
          has_block = true
        end
      end

      offset = payload_start + size
    end

    [ min_ts, max_ts, has_block, offset ]
  end

  def parse_block_group_relative_timestamp!(bytes, start_at, end_at)
    offset = start_at
    steps = 0
    while offset < end_at && steps < 32
      steps += 1
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      return read_block_relative_timestamp(bytes, payload_start, payload_start + size) if id == WEBM_BLOCK_ID
      offset = payload_start + size
    end
    nil
  end

  def read_block_relative_timestamp(bytes, start_at, end_at)
    track_len = vint_length(bytes.getbyte(start_at), max_length: 8)
    return nil unless track_len && start_at + track_len + 2 <= end_at

    bytes.byteslice(start_at + track_len, 2).unpack1("s>")
  end

  def ogg_duration!(bytes)
    offset = 0
    limit = bytes.bytesize
    pages = 0
    sample_rate = nil
    pre_skip = 0
    max_granule = nil

    while offset < limit
      pages += 1
      raise InvalidAudio, "The recording is not a valid Ogg file." if pages > MAX_OGG_PAGES || offset + 27 > limit
      raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.byteslice(offset, 4) == OGG_MAGIC
      raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.getbyte(offset + 4) == 0

      header_type = bytes.getbyte(offset + 5)
      granule = bytes.byteslice(offset + 6, 8).unpack1("q<")
      segment_count = bytes.getbyte(offset + 26)
      lacing_end = offset + 27 + segment_count
      raise InvalidAudio, "The recording is not a valid Ogg file." if lacing_end > limit

      body_size = 0
      segment_count.times { |i| body_size += bytes.getbyte(offset + 27 + i) }
      page_end = lacing_end + body_size
      raise InvalidAudio, "The recording is not a valid Ogg file." if page_end > limit

      if (header_type & 0x02) != 0 && sample_rate.nil?
        payload = bytes.byteslice(lacing_end, body_size)
        if payload.bytesize >= 19 && payload.start_with?("OpusHead".b)
          sample_rate = OPUS_GRANULE_RATE
          pre_skip = payload.byteslice(10, 2).unpack1("v")
        elsif payload.bytesize >= 30 && payload.start_with?("\x01vorbis".b)
          rate = payload.byteslice(12, 4).unpack1("V")
          sample_rate = rate.to_f if rate.positive?
        else
          raise InvalidAudio, "The recording is not a valid Ogg file."
        end
      elsif granule >= 0
        max_granule = max_granule ? [ max_granule, granule ].max : granule
      end

      offset = page_end
    end

    raise InvalidAudio, "The recording is not a valid Ogg file." unless sample_rate&.positive?
    return nil unless max_granule

    samples = max_granule - pre_skip
    return nil unless samples.positive?

    samples / sample_rate
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

    all_ones = (1 << (7 * length)) - 1
    return [ :unknown, offset + length ] if value == all_ones

    [ value, offset + length ]
  end

  def vint_length(first_byte, max_length:)
    return nil if first_byte.nil? || first_byte.zero?

    (1..max_length).each do |length|
      return length if (first_byte & (0x80 >> (length - 1))) != 0
    end
    nil
  end

  def read_uint_be(bytes, offset, length)
    value = 0
    length.times { |index| value = (value << 8) | bytes.getbyte(offset + index) }
    value
  end
end

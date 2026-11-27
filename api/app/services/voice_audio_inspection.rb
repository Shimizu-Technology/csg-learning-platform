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
  WEBM_TRACKS_ID = 0x1654AE6B
  WEBM_TRACK_ENTRY_ID = 0xAE
  WEBM_TRACK_NUMBER_ID = 0xD7
  WEBM_TRACK_TYPE_ID = 0x83
  WEBM_DEFAULT_DURATION_ID = 0x23E383
  WEBM_CODEC_ID = 0x86
  WEBM_CLUSTER_ID = 0x1F43B675
  WEBM_CLUSTER_TIMESTAMP_ID = 0xE7
  WEBM_SIMPLE_BLOCK_ID = 0xA3
  WEBM_BLOCK_GROUP_ID = 0xA0
  WEBM_BLOCK_ID = 0xA1
  WEBM_BLOCK_DURATION_ID = 0x9B
  WEBM_TIMECODE_SCALE_ID = 0x2AD7B1
  WEBM_DURATION_ID = 0x4489
  WEBM_AUDIO_TRACK_TYPE = 2
  WEBM_SEGMENT_CHILD_IDS = [
    0x114D9B74, # SeekHead
    WEBM_INFO_ID,
    WEBM_TRACKS_ID,
    WEBM_CLUSTER_ID,
    0x1C53BB6B, # Cues
    0x1941A469, # Attachments
    0x1043A770, # Chapters
    0x1254C367, # Tags
    0xEC # Void
  ].freeze
  DEFAULT_WEBM_TIMECODE_SCALE = 1_000_000
  ALLOWED_WEBM_DOCTYPES = %w[webm matroska].freeze
  MAX_EBML_ELEMENTS = 65_536
  MAX_OGG_PAGES = 32_768
  MAX_OGG_HEADER_PACKET_BYTES = 1.megabyte
  OPUS_GRANULE_RATE = 48_000.0
  OPUS_FRAME_DURATION_US = [
    10_000, 20_000, 40_000, 60_000,
    10_000, 20_000, 40_000, 60_000,
    10_000, 20_000, 40_000, 60_000,
    10_000, 20_000, 10_000, 20_000,
    2_500, 5_000, 10_000, 20_000,
    2_500, 5_000, 10_000, 20_000,
    2_500, 5_000, 10_000, 20_000,
    2_500, 5_000, 10_000, 20_000
  ].freeze
  OGG_CRC_TABLE = Array.new(256) do |index|
    crc = index << 24
    8.times { crc = (crc & 0x80000000).zero? ? ((crc << 1) & 0xFFFFFFFF) : (((crc << 1) ^ 0x04C11DB7) & 0xFFFFFFFF) }
    crc
  end.freeze

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
    budget = [ MAX_EBML_ELEMENTS ]
    while offset < limit
      consume_ebml_budget!(budget)
      id, after_el = read_ebml_id(bytes, offset, limit)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_el, limit)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil?

      if id == WEBM_SEGMENT_ID
        if size != :unknown && payload_start + size != limit
          raise InvalidAudio, "The recording is not a valid WebM file."
        end
        segment_end = size == :unknown ? limit : payload_start + size
        return parse_webm_segment!(bytes, payload_start, segment_end, budget)
      end

      raise InvalidAudio, "The recording is not a valid WebM file." if size == :unknown || payload_start + size > limit
      offset = payload_start + size
    end

    raise InvalidAudio, "The recording is not a valid WebM file."
  end

  def consume_ebml_budget!(budget)
    budget[0] -= 1
    raise InvalidAudio, "The recording is not a valid WebM file." if budget[0].negative?
  end

  def parse_ebml_doctype!(bytes, start_at, end_at)
    offset = start_at
    doctype = nil
    steps = 0
    while offset < end_at
      steps += 1
      raise InvalidAudio, "The recording is not a valid WebM file." if steps > 64

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

  def parse_webm_segment!(bytes, start_at, end_at, budget)
    offset = start_at
    info_parsed = false
    timecode_scale = DEFAULT_WEBM_TIMECODE_SCALE
    info_duration_ticks = nil
    audio_tracks = {}
    min_ts = nil
    max_end_ts = nil
    audio_block_count = 0

    while offset < end_at
      consume_ebml_budget!(budget)
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil?
      if size != :unknown && payload_start + size > end_at
        raise InvalidAudio, "The recording is not a valid WebM file."
      end

      element_end = size == :unknown ? end_at : payload_start + size

      if id == WEBM_INFO_ID
        raise InvalidAudio, "The recording is not a valid WebM file." if size == :unknown
        info_parsed = true
        timecode_scale, info_duration_ticks = parse_webm_info!(bytes, payload_start, element_end, budget)
      elsif id == WEBM_TRACKS_ID
        raise InvalidAudio, "The recording is not a valid WebM file." if size == :unknown
        audio_tracks.merge!(parse_webm_tracks!(bytes, payload_start, element_end, budget))
      elsif id == WEBM_CLUSTER_ID
        cluster_min, cluster_max_end, cluster_blocks, next_offset = parse_webm_cluster!(
          bytes,
          payload_start,
          element_end,
          audio_tracks: audio_tracks,
          timecode_scale: timecode_scale,
          budget: budget,
          unknown_size: size == :unknown
        )
        if cluster_min && cluster_max_end
          min_ts = min_ts ? [ min_ts, cluster_min ].min : cluster_min
          max_end_ts = max_end_ts ? [ max_end_ts, cluster_max_end ].max : cluster_max_end
        end
        audio_block_count += cluster_blocks
        offset = next_offset
        next
      elsif size == :unknown
        raise InvalidAudio, "The recording is not a valid WebM file."
      end

      offset = element_end
    end

    raise InvalidAudio, "The recording is not a valid WebM file." unless offset == end_at && info_parsed && audio_tracks.any? && timecode_scale.positive?
    raise InvalidAudio, "The recording is not a valid WebM file." unless audio_block_count.positive?

    info_seconds = info_duration_ticks ? (info_duration_ticks * timecode_scale) / 1_000_000_000.0 : nil
    timeline_seconds = if min_ts && max_end_ts && max_end_ts > min_ts
      ((max_end_ts - min_ts) * timecode_scale) / 1_000_000_000.0
    end

    [ info_seconds, timeline_seconds ].compact.max
  end

  def parse_webm_info!(bytes, start_at, end_at, budget)
    timecode_scale = DEFAULT_WEBM_TIMECODE_SCALE
    duration_ticks = nil
    offset = start_at

    while offset < end_at
      consume_ebml_budget!(budget)
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

  def parse_webm_tracks!(bytes, start_at, end_at, budget)
    tracks = {}
    offset = start_at
    while offset < end_at
      consume_ebml_budget!(budget)
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_TRACK_ENTRY_ID
        entry = parse_webm_track_entry!(bytes, payload_start, payload_start + size, budget)
        if entry[:track_type] == WEBM_AUDIO_TRACK_TYPE && entry[:track_number]&.positive?
          tracks[entry[:track_number]] = entry
        end
      end

      offset = payload_start + size
    end
    tracks
  end

  def parse_webm_track_entry!(bytes, start_at, end_at, budget)
    entry = {}
    offset = start_at
    while offset < end_at
      consume_ebml_budget!(budget)
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_TRACK_NUMBER_ID && size.between?(1, 8)
        entry[:track_number] = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_TRACK_TYPE_ID && size.between?(1, 8)
        entry[:track_type] = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_DEFAULT_DURATION_ID && size.between?(1, 8)
        entry[:default_duration_ns] = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_CODEC_ID && size.between?(1, 64)
        entry[:codec_id] = bytes.byteslice(payload_start, size).delete("\x00".b)
      end

      offset = payload_start + size
    end
    entry
  end

  def parse_webm_cluster!(bytes, start_at, end_at, audio_tracks:, timecode_scale:, budget:, unknown_size: false)
    offset = start_at
    cluster_ts = nil
    min_ts = nil
    max_end_ts = nil
    block_count = 0

    while offset < end_at
      consume_ebml_budget!(budget)
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      # Unknown-size Cluster ends when the next top-level Segment child begins.
      if unknown_size && WEBM_SEGMENT_CHILD_IDS.include?(id)
        return [ min_ts, max_end_ts, block_count, offset ]
      end

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_CLUSTER_TIMESTAMP_ID && size.between?(1, 8)
        cluster_ts = read_uint_be(bytes, payload_start, size)
      elsif id == WEBM_SIMPLE_BLOCK_ID
        block = parse_webm_block!(bytes, payload_start, payload_start + size)
        track = audio_tracks[block[:track_number]]
        if cluster_ts && track
          start_ticks = cluster_ts + block[:rel_ts]
          end_ticks = start_ticks + block_duration_ticks(bytes, block, track: track, explicit_duration_ticks: nil, timecode_scale: timecode_scale)
          min_ts = min_ts ? [ min_ts, start_ticks ].min : start_ticks
          max_end_ts = max_end_ts ? [ max_end_ts, end_ticks ].max : end_ticks
          block_count += 1
        end
      elsif id == WEBM_BLOCK_GROUP_ID
        block, explicit_duration_ticks = parse_block_group!(bytes, payload_start, payload_start + size, budget)
        track = block && audio_tracks[block[:track_number]]
        if cluster_ts && track
          start_ticks = cluster_ts + block[:rel_ts]
          end_ticks = start_ticks + block_duration_ticks(bytes, block, track: track, explicit_duration_ticks: explicit_duration_ticks, timecode_scale: timecode_scale)
          min_ts = min_ts ? [ min_ts, start_ticks ].min : start_ticks
          max_end_ts = max_end_ts ? [ max_end_ts, end_ticks ].max : end_ticks
          block_count += 1
        end
      end

      offset = payload_start + size
    end

    [ min_ts, max_end_ts, block_count, offset ]
  end

  def parse_block_group!(bytes, start_at, end_at, budget)
    offset = start_at
    block = nil
    block_duration = nil
    while offset < end_at
      consume_ebml_budget!(budget)
      id, after_id = read_ebml_id(bytes, offset, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." unless id

      size, payload_start = read_ebml_size(bytes, after_id, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if size.nil? || size == :unknown || payload_start + size > end_at

      if id == WEBM_BLOCK_ID
        block = parse_webm_block!(bytes, payload_start, payload_start + size)
      elsif id == WEBM_BLOCK_DURATION_ID && size.between?(1, 8)
        block_duration = read_uint_be(bytes, payload_start, size)
      end

      offset = payload_start + size
    end
    [ block, block_duration ]
  end

  def parse_webm_block!(bytes, start_at, end_at)
    track_number, after_track = read_ebml_size(bytes, start_at, end_at)
    if track_number.nil? || track_number == :unknown || track_number.zero? || after_track + 3 > end_at
      raise InvalidAudio, "The recording is not a valid WebM file."
    end

    rel_ts = bytes.byteslice(after_track, 2).unpack1("s>")
    flags = bytes.getbyte(after_track + 2)
    {
      track_number: track_number,
      rel_ts: rel_ts,
      lacing: (flags >> 1) & 0x03,
      data_start: after_track + 3,
      data_end: end_at
    }
  end

  def block_duration_ticks(bytes, block, track:, explicit_duration_ticks:, timecode_scale:)
    return explicit_duration_ticks.to_f if explicit_duration_ticks&.positive?

    frame_count = block_frame_count(bytes, block)
    if track[:default_duration_ns]&.positive?
      return (track[:default_duration_ns].to_f * frame_count) / timecode_scale
    end

    if track[:codec_id] == "A_OPUS"
      opus_ns = opus_block_duration_ns(bytes, block)
      return opus_ns.to_f / timecode_scale if opus_ns&.positive?
    end

    0.0
  end

  def block_frame_count(bytes, block)
    return 1 if block[:lacing].zero?
    raise InvalidAudio, "The recording is not a valid WebM file." if block[:data_start] >= block[:data_end]

    bytes.getbyte(block[:data_start]) + 1
  end

  def opus_block_duration_ns(bytes, block)
    start_at = block[:data_start]
    end_at = block[:data_end]
    return nil if start_at >= end_at

    if block[:lacing].zero?
      return opus_packet_duration_ns(bytes, start_at, end_at)
    end

    # Laced frames: byte 0 is (frame_count - 1).
    frame_count = bytes.getbyte(start_at) + 1
    cursor = start_at + 1
    case block[:lacing]
    when 2 # Fixed-size lacing
      remaining = end_at - cursor
      raise InvalidAudio, "The recording is not a valid WebM file." unless remaining.positive? && (remaining % frame_count).zero?
      frame_size = remaining / frame_count
      total = 0
      frame_count.times do |index|
        dur = opus_packet_duration_ns(bytes, cursor + (index * frame_size), cursor + ((index + 1) * frame_size))
        return nil unless dur
        total += dur
      end
      total
    when 1 # Xiph lacing
      sizes = []
      (frame_count - 1).times do
        size = 0
        loop do
          raise InvalidAudio, "The recording is not a valid WebM file." if cursor >= end_at
          byte = bytes.getbyte(cursor)
          cursor += 1
          size += byte
          break if byte < 255
        end
        sizes << size
      end
      last_size = end_at - cursor - sizes.sum
      raise InvalidAudio, "The recording is not a valid WebM file." if last_size <= 0
      sizes << last_size
      total = 0
      sizes.each do |size|
        dur = opus_packet_duration_ns(bytes, cursor, cursor + size)
        return nil unless dur
        total += dur
        cursor += size
      end
      total
    when 3 # EBML lacing
      sizes = []
      first_size, cursor = read_ebml_size(bytes, cursor, end_at)
      raise InvalidAudio, "The recording is not a valid WebM file." if first_size.nil? || first_size == :unknown
      sizes << first_size
      prev = first_size
      (frame_count - 2).times do
        raw, next_cursor = read_ebml_size(bytes, cursor, end_at)
        raise InvalidAudio, "The recording is not a valid WebM file." if raw.nil? || raw == :unknown
        len = next_cursor - cursor
        bias = (1 << ((7 * len) - 1)) - 1
        prev += (raw - bias)
        raise InvalidAudio, "The recording is not a valid WebM file." if prev <= 0
        sizes << prev
        cursor = next_cursor
      end
      last_size = end_at - cursor - sizes.sum
      raise InvalidAudio, "The recording is not a valid WebM file." if last_size <= 0
      sizes << last_size
      total = 0
      sizes.each do |size|
        dur = opus_packet_duration_ns(bytes, cursor, cursor + size)
        return nil unless dur
        total += dur
        cursor += size
      end
      total
    end
  end

  def opus_packet_duration_ns(bytes, start_at, end_at)
    return nil if start_at >= end_at

    toc = bytes.getbyte(start_at)
    frame_us = OPUS_FRAME_DURATION_US[toc >> 3]
    code = toc & 0x03
    frames = case code
    when 0 then 1
    when 1, 2 then 2
    when 3
      return nil if start_at + 1 >= end_at
      count = bytes.getbyte(start_at + 1) & 0x3F
      return nil unless count.between?(1, 48)
      count
    end
    frame_us * 1_000 * frames
  end

  def ogg_duration!(bytes)
    offset = 0
    limit = bytes.bytesize
    pages = 0
    stream_serial = nil
    expected_sequence = 0
    expecting_continuation = false
    seen_eos = false

    codec = nil
    sample_rate = nil
    pre_skip = 0
    header_packets = []
    current_packet = +"".b
    last_granule = nil

    while offset < limit
      pages += 1
      raise InvalidAudio, "The recording is not a valid Ogg file." if pages > MAX_OGG_PAGES || offset + 27 > limit
      raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.byteslice(offset, 4) == OGG_MAGIC
      raise InvalidAudio, "The recording is not a valid Ogg file." unless bytes.getbyte(offset + 4) == 0

      header_type = bytes.getbyte(offset + 5)
      raise InvalidAudio, "The recording is not a valid Ogg file." unless (header_type & ~0x07).zero?

      granule = bytes.byteslice(offset + 6, 8).unpack1("q<")
      serial = bytes.byteslice(offset + 14, 4).unpack1("V")
      sequence = bytes.byteslice(offset + 18, 4).unpack1("V")
      expected_crc = bytes.byteslice(offset + 22, 4).unpack1("V")
      segment_count = bytes.getbyte(offset + 26)
      lacing_end = offset + 27 + segment_count
      raise InvalidAudio, "The recording is not a valid Ogg file." if lacing_end > limit

      body_size = 0
      segment_count.times { |i| body_size += bytes.getbyte(offset + 27 + i) }
      page_end = lacing_end + body_size
      raise InvalidAudio, "The recording is not a valid Ogg file." if page_end > limit
      raise InvalidAudio, "The recording is not a valid Ogg file." unless ogg_page_crc(bytes, offset, page_end) == expected_crc

      is_continuation = (header_type & 0x01) != 0
      is_bos = (header_type & 0x02) != 0
      is_eos = (header_type & 0x04) != 0

      if pages == 1
        raise InvalidAudio, "The recording is not a valid Ogg file." unless is_bos && !is_continuation && sequence.zero?
        stream_serial = serial
      else
        # Reject chained or multiplexed Ogg streams and any page after EOS.
        raise InvalidAudio, "The recording is not a valid Ogg file." if seen_eos || is_bos
        raise InvalidAudio, "The recording is not a valid Ogg file." unless serial == stream_serial && sequence == expected_sequence
        raise InvalidAudio, "The recording is not a valid Ogg file." unless is_continuation == expecting_continuation
      end
      expected_sequence += 1

      audio_packets_completed = 0
      data_cursor = lacing_end
      last_lacing = nil
      segment_count.times do |i|
        lacing = bytes.getbyte(offset + 27 + i)
        last_lacing = lacing
        required_headers = codec == :vorbis ? 3 : 2
        if header_packets.length < required_headers
          raise InvalidAudio, "The recording is not a valid Ogg file." if current_packet.bytesize + lacing > MAX_OGG_HEADER_PACKET_BYTES
          current_packet << bytes.byteslice(data_cursor, lacing)
        end
        data_cursor += lacing
        next unless lacing < 255

        if header_packets.length < required_headers
          header_packets << current_packet
          current_packet = +"".b
          if header_packets.length == 1
            codec, sample_rate, pre_skip = parse_ogg_id_header!(header_packets[0])
          elsif header_packets.length == 2
            validate_ogg_comment_header!(codec, header_packets[1])
          elsif header_packets.length == 3 && codec == :vorbis
            raise InvalidAudio, "The recording is not a valid Ogg file." unless header_packets[2].start_with?("\x05vorbis".b)
          end
        else
          audio_packets_completed += 1
        end
      end
      expecting_continuation = segment_count.positive? && last_lacing == 255

      if audio_packets_completed.positive?
        raise InvalidAudio, "The recording is not a valid Ogg file." if granule.negative?
        raise InvalidAudio, "The recording is not a valid Ogg file." if last_granule && granule < last_granule
        last_granule = granule
      end

      seen_eos = true if is_eos
      offset = page_end
    end

    required_headers = codec == :vorbis ? 3 : 2
    raise InvalidAudio, "The recording is not a valid Ogg file." unless seen_eos && !expecting_continuation && header_packets.length >= required_headers && sample_rate&.positive?
    return nil unless last_granule

    samples = last_granule - pre_skip
    return nil unless samples.positive?

    samples / sample_rate
  end

  def parse_ogg_id_header!(packet)
    if packet.bytesize >= 19 && packet.start_with?("OpusHead".b)
      version = packet.getbyte(8)
      channels = packet.getbyte(9)
      raise InvalidAudio, "The recording is not a valid Ogg file." unless version == 1 && channels&.positive?
      pre_skip = packet.byteslice(10, 2).unpack1("v")
      [ :opus, OPUS_GRANULE_RATE, pre_skip ]
    elsif packet.bytesize >= 30 && packet.start_with?("\x01vorbis".b)
      rate = packet.byteslice(12, 4).unpack1("V")
      raise InvalidAudio, "The recording is not a valid Ogg file." unless rate.positive?
      [ :vorbis, rate.to_f, 0 ]
    else
      raise InvalidAudio, "The recording is not a valid Ogg file."
    end
  end

  def validate_ogg_comment_header!(codec, packet)
    valid = case codec
    when :opus then packet.bytesize >= 16 && packet.start_with?("OpusTags".b)
    when :vorbis then packet.bytesize >= 15 && packet.start_with?("\x03vorbis".b)
    else false
    end
    raise InvalidAudio, "The recording is not a valid Ogg file." unless valid
  end

  def ogg_page_crc(bytes, start_at, end_at)
    crc = 0
    index = start_at
    while index < end_at
      byte = (index >= start_at + 22 && index < start_at + 26) ? 0 : bytes.getbyte(index)
      crc = ((crc << 8) & 0xFFFFFFFF) ^ OGG_CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]
      index += 1
    end
    crc
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

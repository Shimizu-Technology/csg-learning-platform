class VoiceAudioInspection
  class InvalidAudio < StandardError; end

  MAX_BYTES = 6.megabytes
  MAX_DURATION_SECONDS = 300.0
  ALLOWED_CONTENT_TYPES = %w[audio/mp4 audio/m4a audio/x-m4a].freeze
  CONTAINER_BOXES = %w[moov trak mdia minf stbl].freeze

  def self.call(upload)
    new(upload).call
  end

  def initialize(upload)
    @upload = upload
  end

  def call
    content_type = @upload.content_type.to_s.downcase
    opaque_m4a = content_type == "application/octet-stream" && File.extname(@upload.original_filename.to_s).casecmp?(".m4a")
    raise InvalidAudio, "Choose an M4A recording." unless ALLOWED_CONTENT_TYPES.include?(content_type) || opaque_m4a
    raise InvalidAudio, "The recording is empty." unless @upload.size.to_i.positive?
    raise InvalidAudio, "The recording is too large." if @upload.size.to_i > MAX_BYTES

    bytes = @upload.tempfile.read
    @upload.tempfile.rewind
    raise InvalidAudio, "The recording is not a valid M4A file." unless bytes.bytesize >= 12 && bytes.byteslice(4, 4) == "ftyp"

    duration = movie_duration(bytes)
    raise InvalidAudio, "The recording duration could not be verified." unless duration&.positive?
    raise InvalidAudio, "Recordings must be 5 minutes or shorter." if duration > MAX_DURATION_SECONDS + 0.5

    { duration_seconds: duration.round(1), content_type: "audio/mp4" }
  end

  private

  def movie_duration(bytes)
    each_box(bytes, 0, bytes.bytesize) do |type, payload_start, box_end|
      next unless type == "mvhd"

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
end

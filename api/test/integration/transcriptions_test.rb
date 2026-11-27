require "test_helper"
require "tempfile"

class TranscriptionsTest < ActionDispatch::IntegrationTest
  def setup
    @student = User.create!(clerk_id: "voice_student", email: "voice@example.com", first_name: "Voice", last_name: "Student", role: :student)
  end

  test "authenticated user receives a reviewable voice draft" do
    service = Object.new
    service.define_singleton_method(:call) do |upload:, duration_seconds:, content_type:, extension:|
      raise "missing upload" unless upload
      raise "unexpected format" unless content_type == "audio/mp4" && extension == "m4a"
      { raw_text: "hello there", suggested_text: "Hello there.", duration_seconds: duration_seconds, warnings: [] }
    end

    Api::V1::TranscriptionsController::SURFACES.each do |surface|
      with_voice_enabled do
        with_upload(m4a_bytes(duration_seconds: 3)) do |upload|
          with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
            with_singleton_method(VoiceTranscriptionService, :new, ->(*) { service }) do
              as_user(@student) do
                post "/api/v1/transcriptions", params: { audio: upload, surface: surface, cleanup: "conservative" }, headers: auth_headers
              end
            end
          end
        end
      end

      assert_response :success
      payload = JSON.parse(response.body)
      assert_equal "hello there", payload.fetch("raw_text")
      assert_equal "Hello there.", payload.fetch("suggested_text")
      assert_equal 3.0, payload.fetch("duration_seconds")
    end
  end

  test "accepts browser webm and ogg uploads and derives duration from container" do
    captured = []
    service = Object.new
    service.define_singleton_method(:call) do |upload:, duration_seconds:, content_type:, extension:|
      captured << { content_type: content_type, extension: extension, duration_seconds: duration_seconds }
      { raw_text: "browser audio", suggested_text: "Browser audio.", duration_seconds: duration_seconds, warnings: [] }
    end

    streamed_webm = webm_stream_bytes(cluster_timestamps_ms: [ 0, 11_400 ])
    ogg_opus = ogg_opus_bytes(duration_seconds: 6.2)
    truncated_webm = "\x1A\x45\xDF\xA3\x84\x42\x82\x84webm\x18\x53\x80\x67\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b
    truncated_ogg = "OggS\x00\x02\x00\x00".b

    with_voice_enabled do
      with_upload(streamed_webm, content_type: "audio/webm;codecs=opus", filename: "voice-draft.webm") do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
          with_singleton_method(VoiceTranscriptionService, :new, ->(*) { service }) do
            as_user(@student) do
              post "/api/v1/transcriptions",
                params: { audio: upload, surface: "grading_feedback", cleanup: "conservative", duration_seconds: "1.0" },
                headers: auth_headers
            end
          end
        end
      end

      assert_response :success
      assert_equal({ content_type: "audio/webm", extension: "webm", duration_seconds: 11.4 }, captured.last)

      with_upload(ogg_opus, content_type: "audio/ogg;codecs=opus", filename: "voice-draft.ogg") do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
          with_singleton_method(VoiceTranscriptionService, :new, ->(*) { service }) do
            as_user(@student) do
              post "/api/v1/transcriptions",
                params: { audio: upload, surface: "help_request", cleanup: "conservative", duration_seconds: "99.0" },
                headers: auth_headers
            end
          end
        end
      end

      assert_response :success
      assert_equal({ content_type: "audio/ogg", extension: "ogg", duration_seconds: 6.2 }, captured.last)

      [
        [ truncated_webm, "audio/webm", "voice-draft.webm" ],
        [ truncated_ogg, "audio/ogg", "voice-draft.ogg" ]
      ].each do |bytes, content_type, filename|
        with_upload(bytes, content_type: content_type, filename: filename) do |upload|
          with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
            as_user(@student) do
              post "/api/v1/transcriptions",
                params: { audio: upload, surface: "message", cleanup: "conservative", duration_seconds: "4.0" },
                headers: auth_headers
            end
          end
        end

        assert_response :unprocessable_entity
      end
    end
  end

  test "rejects disabled, invalid, and rate-limited requests without calling a provider" do
    as_user(@student) do
      post "/api/v1/transcriptions", params: { surface: "message" }, headers: auth_headers
    end
    assert_response :service_unavailable
    assert_equal "voice_disabled", JSON.parse(response.body).fetch("code")

    with_voice_enabled do
      as_user(@student) do
        post "/api/v1/transcriptions", params: { surface: "announcement" }, headers: auth_headers
      end
      assert_response :unprocessable_entity

      as_user(@student) do
        post "/api/v1/transcriptions", params: { surface: "message", cleanup: "rewrite" }, headers: auth_headers
      end
      assert_response :unprocessable_entity

      with_upload(m4a_bytes(duration_seconds: 2)) do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { false }) do
          as_user(@student) do
            post "/api/v1/transcriptions", params: { audio: upload, surface: "message", cleanup: "conservative" }, headers: auth_headers
          end
        end
      end
      assert_response :too_many_requests
      assert response.headers["Retry-After"].present?
    end
  end

  private

  def with_voice_enabled
    prior = ENV["VOICE_TRANSCRIPTION_ENABLED"]
    ENV["VOICE_TRANSCRIPTION_ENABLED"] = "true"
    yield
  ensure
    ENV["VOICE_TRANSCRIPTION_ENABLED"] = prior
  end

  def with_upload(bytes, content_type: "audio/mp4", filename: "voice.m4a")
    tempfile = Tempfile.new([ "voice", File.extname(filename) ])
    tempfile.binmode
    tempfile.write(bytes)
    tempfile.rewind
    upload = Rack::Test::UploadedFile.new(tempfile.path, content_type, true, original_filename: filename)
    yield upload
  ensure
    tempfile&.close!
  end

  def m4a_bytes(duration_seconds:)
    timescale = 1_000
    payload = [ 0, 0, 0, 0, 0, 0, timescale, (duration_seconds * timescale).round ].pack("C4N4")
    box("ftyp", "M4A \0\0\0\0M4A isom") + box("moov", box("mvhd", payload))
  end

  def webm_stream_bytes(cluster_timestamps_ms:)
    ebml_header = ebml_el("\x1A\x45\xDF\xA3".b, ebml_el("\x42\x82".b, "webm".b))
    info = ebml_el("\x15\x49\xA9\x66".b, ebml_el("\x2A\xD7\xB1".b, [ 1_000_000 ].pack("N")))
    tracks = ebml_el(
      "\x16\x54\xAE\x6B".b,
      ebml_el("\xAE".b, ebml_el("\xD7".b, "\x01".b) + ebml_el("\x83".b, "\x02".b) + ebml_el("\x86".b, "A_OPUS".b))
    )
    clusters = cluster_timestamps_ms.map do |ts|
      ebml_el("\x1F\x43\xB6\x75".b, ebml_el("\xE7".b, [ ts ].pack("N")) + ebml_el("\xA3".b, "\x81\x00\x00\x80\xFC\x01".b))
    end.join.b
    ebml_header + "\x18\x53\x80\x67\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b + info + tracks + clusters
  end

  def ogg_opus_bytes(duration_seconds:, pre_skip: 312)
    opus_head = "OpusHead".b + [ 1, 1, pre_skip, 48_000, 0, 0 ].pack("CCvVvC")
    opus_tags = "OpusTags".b + [ 3 ].pack("V") + "csg".b + [ 0 ].pack("V")
    total_samples = pre_skip + (duration_seconds.to_f * 48_000).round
    packets = []
    remaining = total_samples
    while remaining > 0
      frames = [ (remaining.to_f / 2_880).ceil, 48 ].min
      packets << [ 0x1B, frames, 0x00 ].pack("CCC")
      remaining -= frames * 2_880
    end
    ogg_page(0x02, 0, 0, [ opus_head ]) + ogg_page(0x00, 0, 1, [ opus_tags ]) + ogg_page(0x04, total_samples, 2, packets)
  end

  def ogg_page(header_type, granule, seq, packets)
    lacing = packets.map(&:bytesize)
    raw = "OggS".b + [ 0, header_type, granule, 1, seq, 0, lacing.length, *lacing ].pack("CCq<VVVC*") + packets.join.b
    crc = 0
    raw.each_byte { |b| crc = ((crc << 8) & 0xFFFFFFFF) ^ VoiceAudioInspection::OGG_CRC_TABLE[((crc >> 24) ^ b) & 0xFF] }
    raw[22, 4] = [ crc ].pack("V")
    raw
  end

  def ebml_el(id, payload)
    size = payload.bytesize < 0x7F ? [ 0x80 | payload.bytesize ].pack("C") : [ 0x4000 | payload.bytesize ].pack("n")
    id + size + payload
  end

  def box(type, payload) = [ payload.bytesize + 8 ].pack("N") + type + payload
  def auth_headers = { "Authorization" => "Bearer test_token" }

  def with_singleton_method(target, name, replacement)
    original = target.method(name)
    target.define_singleton_method(name, replacement)
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end

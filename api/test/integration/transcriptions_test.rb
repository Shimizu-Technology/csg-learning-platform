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

  test "accepts browser webm and ogg uploads and forwards detected format" do
    captured = []
    service = Object.new
    service.define_singleton_method(:call) do |upload:, duration_seconds:, content_type:, extension:|
      captured << { content_type: content_type, extension: extension, duration_seconds: duration_seconds }
      { raw_text: "browser audio", suggested_text: "Browser audio.", duration_seconds: duration_seconds, warnings: [] }
    end

    streamed_webm = "\x1A\x45\xDF\xA3\x84\x42\x82\x84webm\x18\x53\x80\x67\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b
    with_voice_enabled do
      with_upload(streamed_webm, content_type: "audio/webm;codecs=opus", filename: "voice-draft.webm") do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
          with_singleton_method(VoiceTranscriptionService, :new, ->(*) { service }) do
            as_user(@student) do
              post "/api/v1/transcriptions",
                params: { audio: upload, surface: "grading_feedback", cleanup: "conservative", duration_seconds: "11.4" },
                headers: auth_headers
            end
          end
        end
      end

      assert_response :success
      assert_equal({ content_type: "audio/webm", extension: "webm", duration_seconds: 11.4 }, captured.last)

      with_upload("OggS\x00\x02\x00\x00".b, content_type: "audio/ogg;codecs=opus", filename: "voice-draft.ogg") do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
          with_singleton_method(VoiceTranscriptionService, :new, ->(*) { service }) do
            as_user(@student) do
              post "/api/v1/transcriptions",
                params: { audio: upload, surface: "help_request", cleanup: "conservative", duration_seconds: "6.2" },
                headers: auth_headers
            end
          end
        end
      end

      assert_response :success
      assert_equal({ content_type: "audio/ogg", extension: "ogg", duration_seconds: 6.2 }, captured.last)

      with_upload(streamed_webm, content_type: "audio/webm", filename: "voice-draft.webm") do |upload|
        with_singleton_method(VoiceTranscriptionRateLimiter, :allow?, ->(*) { true }) do
          as_user(@student) do
            post "/api/v1/transcriptions",
              params: { audio: upload, surface: "message", cleanup: "conservative" },
              headers: auth_headers
          end
        end
      end

      assert_response :unprocessable_entity
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

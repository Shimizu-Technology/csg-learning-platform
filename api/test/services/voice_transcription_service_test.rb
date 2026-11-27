require "test_helper"

class VoiceTranscriptionServiceTest < ActiveSupport::TestCase
  test "returns reviewed raw and conservative suggested text and forwards audio format" do
    provider = FakeVoiceProvider.new
    result = VoiceTranscriptionService.new(provider: provider).call(
      upload: Object.new,
      duration_seconds: 8.4,
      content_type: "audio/webm",
      extension: "webm"
    )

    assert_equal "i have two blockers rails and github", result.fetch(:raw_text)
    assert_equal "I have two blockers: Rails and GitHub.", result.fetch(:suggested_text)
    assert_equal 8.4, result.fetch(:duration_seconds)
    assert_empty result.fetch(:warnings)
    assert_equal({ content_type: "audio/webm", extension: "webm" }, provider.last_transcribe_options)
  end

  test "falls back to the faithful transcript when cleanup fails" do
    provider = FakeVoiceProvider.new(cleanup_error: true)
    result = VoiceTranscriptionService.new(provider: provider).call(upload: Object.new, duration_seconds: 4)

    assert_equal result.fetch(:raw_text), result.fetch(:suggested_text)
    assert_equal [ "cleanup_unavailable" ], result.fetch(:warnings)
  end

  test "fails closed without provider credentials" do
    provider = FakeVoiceProvider.new(configured: false)
    assert_raises(VoiceTranscriptionService::NotConfigured) do
      VoiceTranscriptionService.new(provider: provider).call(upload: Object.new, duration_seconds: 1)
    end
  end

  class FakeVoiceProvider
    attr_reader :last_transcribe_options

    def initialize(configured: true, cleanup_error: false)
      @configured = configured
      @cleanup_error = cleanup_error
      @last_transcribe_options = nil
    end

    def configured? = @configured

    def transcribe(_upload, content_type: "audio/mp4", extension: "m4a")
      @last_transcribe_options = { content_type: content_type, extension: extension }
      "i have two blockers rails and github"
    end

    def clean_up(_raw_text)
      raise OpenaiVoiceProvider::ProviderError, "cleanup failed" if @cleanup_error

      { suggested_text: "I have two blockers: Rails and GitHub.", warnings: [] }
    end
  end
end

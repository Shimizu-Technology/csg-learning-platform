require "test_helper"

class VoiceTranscriptionServiceTest < ActiveSupport::TestCase
  test "returns reviewed raw and conservative suggested text" do
    provider = FakeVoiceProvider.new
    result = VoiceTranscriptionService.new(provider: provider).call(upload: Object.new, duration_seconds: 8.4)

    assert_equal "i have two blockers rails and github", result.fetch(:raw_text)
    assert_equal "I have two blockers: Rails and GitHub.", result.fetch(:suggested_text)
    assert_equal 8.4, result.fetch(:duration_seconds)
    assert_empty result.fetch(:warnings)
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
    def initialize(configured: true, cleanup_error: false)
      @configured = configured
      @cleanup_error = cleanup_error
    end

    def configured? = @configured
    def transcribe(_upload) = "i have two blockers rails and github"

    def clean_up(_raw_text)
      raise OpenaiVoiceProvider::ProviderError, "cleanup failed" if @cleanup_error

      { suggested_text: "I have two blockers: Rails and GitHub.", warnings: [] }
    end
  end
end

class VoiceTranscriptionService
  class NotConfigured < StandardError; end

  def initialize(provider: OpenaiVoiceProvider.new)
    @provider = provider
  end

  def call(upload:, duration_seconds:)
    raise NotConfigured unless @provider.configured?

    raw_text = @provider.transcribe(upload)
    cleanup = @provider.clean_up(raw_text)
    {
      raw_text: raw_text,
      suggested_text: cleanup.fetch(:suggested_text),
      duration_seconds: duration_seconds,
      warnings: cleanup.fetch(:warnings)
    }
  rescue OpenaiVoiceProvider::ProviderError => error
    raise if raw_text.blank?

    {
      raw_text: raw_text,
      suggested_text: raw_text,
      duration_seconds: duration_seconds,
      warnings: [ "cleanup_unavailable" ]
    }
  end
end

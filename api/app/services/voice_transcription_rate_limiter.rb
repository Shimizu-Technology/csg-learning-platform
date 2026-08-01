class VoiceTranscriptionRateLimiter
  LIMIT = 10
  WINDOW = 10.minutes

  def self.allow?(user_id, now: Time.current)
    bucket = now.to_i / WINDOW.to_i
    key = "voice-transcription-rate:#{user_id}:#{bucket}"
    Rails.cache.write(key, 0, expires_in: WINDOW * 2, unless_exist: true)
    Rails.cache.increment(key, 1, expires_in: WINDOW * 2).to_i <= LIMIT
  end
end

class CableToken
  PURPOSE = :action_cable_connection
  EXPIRES_IN = 90.seconds

  class << self
    def issue_for(user)
      nonce = SecureRandom.hex(16)
      token_store.write(cache_key(nonce), user.id, expires_in: EXPIRES_IN)
      verifier.generate({ user_id: user.id, nonce: nonce }, expires_in: EXPIRES_IN, purpose: PURPOSE)
    end

    def consume(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload

      nonce = payload.fetch("nonce")
      user_id = payload.fetch("user_id")
      cached_user_id = token_store.read(cache_key(nonce))
      return nil unless cached_user_id.to_i == user_id.to_i

      token_store.delete(cache_key(nonce))
      User.find_by(id: user_id)
    rescue KeyError
      nil
    end

    private

    def verifier
      Rails.application.message_verifier(:cable_token)
    end

    def token_store
      return Rails.cache unless Rails.cache.is_a?(ActiveSupport::Cache::NullStore)

      @token_store ||= ActiveSupport::Cache::MemoryStore.new
    end

    def cache_key(nonce)
      "cable_token:#{nonce}"
    end
  end
end

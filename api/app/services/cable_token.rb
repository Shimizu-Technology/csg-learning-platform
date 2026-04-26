class CableToken
  PURPOSE = :action_cable_connection
  EXPIRES_IN = 90.seconds

  class << self
    def issue_for(user)
      nonce = SecureRandom.hex(16)
      CableTokenNonce.expired_or_used.delete_all
      CableTokenNonce.create!(user: user, nonce: nonce, expires_at: EXPIRES_IN.from_now)

      verifier.generate({ user_id: user.id, nonce: nonce }, expires_in: EXPIRES_IN, purpose: PURPOSE)
    end

    def consume(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload

      user_id = payload.fetch("user_id")
      nonce = payload.fetch("nonce")

      CableTokenNonce.transaction do
        record = CableTokenNonce.lock.find_by(nonce: nonce, user_id: user_id)
        return nil if record.nil?
        return nil if record.used_at.present? || record.expires_at <= Time.current

        record.update!(used_at: Time.current)
      end

      User.find_by(id: user_id)
    rescue KeyError
      nil
    end

    private

    def verifier
      Rails.application.message_verifier(:cable_token)
    end
  end
end

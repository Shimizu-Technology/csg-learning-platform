class CableToken
  PURPOSE = :action_cable_connection
  EXPIRES_IN = 90.seconds

  class << self
    def issue_for(user)
      verifier.generate({ user_id: user.id }, expires_in: EXPIRES_IN, purpose: PURPOSE)
    end

    def consume(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload

      user_id = payload.fetch("user_id")
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

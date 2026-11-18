require "base64"

class GithubIdentityAuthorization
  PURPOSE = "github-user-identity".freeze

  def self.prepare(user:, enrollment:, client: GithubUserAuthorizationClient.new)
    authorize!(user: user, enrollment: enrollment)
    raise GithubAppClient::Error, "GitHub user authorization is not configured" unless GithubAppCredentials.oauth_configured?

    nonce = SecureRandom.urlsafe_base64(32)
    verifier = SecureRandom.urlsafe_base64(48)
    user.with_lock { user.update!(github_authorization_nonce_digest: Digest::SHA256.hexdigest(nonce)) }
    state = encryptor.encrypt_and_sign({ "user_id" => user.id, "enrollment_id" => enrollment.id,
      "client_id" => GithubAppCredentials.client_id, "callback_url" => GithubAppCredentials.user_callback_url,
      "nonce" => nonce, "code_verifier" => verifier }, purpose: PURPOSE, expires_in: 10.minutes)
    challenge = Base64.urlsafe_encode64(Digest::SHA256.digest(verifier), padding: false)
    { authorization_url: client.authorization_url(state: state, code_challenge: challenge) }
  end

  def self.connect(user:, state:, code:, client: GithubUserAuthorizationClient.new)
    raise ActiveRecord::RecordNotFound unless state.is_a?(String) && state.bytesize.between?(1, 8192)

    context = encryptor.decrypt_and_verify(state, purpose: PURPOSE)
    unless context.is_a?(Hash) && context["user_id"] == user.id && context["client_id"] == GithubAppCredentials.client_id && context["callback_url"] == GithubAppCredentials.user_callback_url
      raise ActiveRecord::RecordNotFound
    end
    enrollment = user.enrollments.includes(:cohort).find(context.fetch("enrollment_id"))
    authorize!(user: user, enrollment: enrollment)
    # Consume once before provider I/O; no HTTP under a database lock. The PKCE
    # verifier lives only inside authenticated encrypted state, not a DB row.
    user.with_lock do
      expected = Digest::SHA256.hexdigest(context.fetch("nonce"))
      unless user.github_authorization_nonce_digest.present? && ActiveSupport::SecurityUtils.secure_compare(user.github_authorization_nonce_digest, expected)
        raise ActiveRecord::RecordNotFound
      end
      user.update!(github_authorization_nonce_digest: nil)
    end
    person = client.identity(code: code, code_verifier: context.fetch("code_verifier"))
    user.record_verified_github_identity!(id: person.fetch(:id), login: person.fetch(:login))
    { github_identity: GithubAppSerializer.identity(user), enrollment_id: enrollment.id, cohort_id: enrollment.cohort_id }
  rescue ActiveSupport::MessageEncryptor::InvalidMessage, KeyError, TypeError
    raise ActiveRecord::RecordNotFound
  end

  def self.authorize!(user:, enrollment:)
    unless enrollment.user_id == user.id && enrollment.active? && !user.archived? && !user.invite_pending? && GithubRepositoryAccess.enabled?(enrollment.cohort)
      raise ActiveRecord::RecordNotFound
    end
  end

  def self.encryptor
    key = Rails.application.key_generator.generate_key(PURPOSE, ActiveSupport::MessageEncryptor.key_len("aes-256-gcm"))
    ActiveSupport::MessageEncryptor.new(key, cipher: "aes-256-gcm")
  end
end

class ClerkProductionProvisioner
  BASE_URL = "https://api.clerk.com/v1/users"
  PAGE_SIZE = 100
  Result = Data.define(:user_id, :email, :status, :clerk_user_id, :detail)

  def initialize(environment:, apply: false)
    @environment = environment
    @apply = apply
  end

  def call
    unless @environment&.production? && @environment.secret_key.present?
      raise ArgumentError, "A configured Clerk production environment is required"
    end

    clerk_users = fetch_all_users
    by_external_id = clerk_users.each_with_object(Hash.new { |index, key| index[key] = [] }) do |user, index|
      external_id = user["external_id"].to_s.presence
      index[external_id] << user if external_id
    end
    by_email = clerk_users.each_with_object(Hash.new { |index, key| index[key] = [] }) do |user, index|
      email = primary_email(user)
      index[email] << user if email
    end

    eligible_users.map do |user|
      provision(user, by_external_id: by_external_id, by_email: by_email)
    end
  end

  private

  def eligible_users
    User.not_archived.where.not("clerk_id LIKE ?", "pending_%").order(:id)
  end

  def provision(user, by_external_id:, by_email:)
    candidates = (by_external_id[user.id.to_s] + by_email[user.email.downcase]).uniq { |candidate| candidate["id"] }
    if candidates.many?
      return Result.new(user.id, user.email, :conflict, nil, "multiple production users match this Rails user")
    end

    clerk_user = candidates.first
    if clerk_user
      clerk_email = primary_email(clerk_user)
      if clerk_email != user.email.downcase
        return Result.new(user.id, user.email, :conflict, clerk_user["id"], "production email does not match")
      end
      unless primary_email_verified?(clerk_user)
        return Result.new(user.id, user.email, :conflict, clerk_user["id"], "production primary email is not verified")
      end
      if clerk_user["external_id"].present? && clerk_user["external_id"].to_s != user.id.to_s
        return Result.new(user.id, user.email, :conflict, clerk_user["id"], "production external ID belongs to another user")
      end

      return attach_existing(user, clerk_user)
    end

    return Result.new(user.id, user.email, :would_create, nil, nil) unless @apply

    response = HTTParty.post(
      BASE_URL,
      headers: request_headers,
      body: {
        email_address: [ user.email ],
        first_name: user.first_name,
        last_name: user.last_name,
        external_id: user.id.to_s,
        skip_password_requirement: true
      }.compact.to_json,
      timeout: 10
    )
    unless response.success?
      return Result.new(user.id, user.email, :failed, nil, "Clerk status #{response.code}")
    end

    clerk_user_id = response.parsed_response.is_a?(Hash) && response.parsed_response["id"].to_s.presence
    return Result.new(user.id, user.email, :failed, nil, "Clerk response did not include a user ID") unless clerk_user_id
    unless primary_email(response.parsed_response) == user.email.downcase && primary_email_verified?(response.parsed_response)
      return Result.new(user.id, user.email, :failed, clerk_user_id, "Clerk response did not confirm the verified primary email")
    end
    unless response.parsed_response["external_id"].to_s == user.id.to_s
      return Result.new(user.id, user.email, :failed, clerk_user_id, "Clerk response did not confirm the Rails external ID")
    end

    unless attach_identity(user, clerk_user_id)
      return Result.new(user.id, user.email, :conflict, clerk_user_id, "production identity could not be attached")
    end

    Result.new(user.id, user.email, :created, clerk_user_id, nil)
  rescue HTTParty::Error, Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError => error
    Result.new(user.id, user.email, :failed, nil, error.class.name)
  end

  def attach_existing(user, clerk_user)
    identity = user.clerk_identities.find_by(issuer: @environment.issuer)
    if identity && identity.clerk_user_id != clerk_user.fetch("id")
      return Result.new(user.id, user.email, :conflict, clerk_user["id"], "user already has a different production subject")
    end

    owner = ClerkIdentity.find_by(issuer: @environment.issuer, clerk_user_id: clerk_user.fetch("id"))
    if owner && owner.user_id != user.id
      return Result.new(user.id, user.email, :conflict, clerk_user["id"], "production subject belongs to another user")
    end

    return Result.new(user.id, user.email, :found, clerk_user.fetch("id"), nil) unless @apply

    unless identity || attach_identity(user, clerk_user.fetch("id"))
      return Result.new(user.id, user.email, :conflict, clerk_user["id"], "production identity could not be attached")
    end

    Result.new(user.id, user.email, identity ? :unchanged : :attached, clerk_user.fetch("id"), nil)
  end

  def attach_identity(user, clerk_user_id)
    user.with_lock do
      existing = user.clerk_identities.find_by(issuer: @environment.issuer)
      return existing.clerk_user_id == clerk_user_id if existing

      owner = ClerkIdentity.find_by(issuer: @environment.issuer, clerk_user_id: clerk_user_id)
      return false if owner

      user.clerk_identities.create!(
        issuer: @environment.issuer,
        clerk_user_id: clerk_user_id,
        last_seen_at: nil
      )
      true
    end
  rescue ActiveRecord::RecordNotUnique
    ClerkIdentity.find_by(issuer: @environment.issuer, clerk_user_id: clerk_user_id)&.user_id == user.id
  end

  def fetch_all_users
    users = []
    offset = 0

    loop do
      response = HTTParty.get(
        "#{BASE_URL}?limit=#{PAGE_SIZE}&offset=#{offset}",
        headers: request_headers,
        timeout: 10
      )
      raise "Clerk user inventory failed with status #{response.code}" unless response.success?

      page = Array(response.parsed_response)
      users.concat(page)
      break if page.length < PAGE_SIZE

      offset += PAGE_SIZE
    end

    users
  end

  def primary_email(clerk_user)
    primary_email_record(clerk_user)&.fetch("email_address", nil)&.strip&.downcase
  end

  def primary_email_verified?(clerk_user)
    primary_email_record(clerk_user)&.dig("verification", "status") == "verified"
  end

  def primary_email_record(clerk_user)
    return nil unless clerk_user.is_a?(Hash)

    primary_email_id = clerk_user["primary_email_address_id"].to_s.presence
    return nil unless primary_email_id

    Array(clerk_user["email_addresses"]).find { |email| email["id"] == primary_email_id }
  end

  def request_headers
    {
      "Authorization" => "Bearer #{@environment.secret_key}",
      "Content-Type" => "application/json"
    }
  end
end

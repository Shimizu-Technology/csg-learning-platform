module ClerkAuthenticatable
  extend ActiveSupport::Concern

  private

  def authenticate_user!
    header = request.headers["Authorization"]

    unless header.present?
      render_unauthorized("Missing authorization header")
      return
    end

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)

    unless decoded
      render_unauthorized("Invalid or expired token")
      return
    end

    clerk_id = decoded["sub"]
    email = decoded["email"] || decoded["primary_email_address"]
    first_name = decoded["first_name"]
    last_name = decoded["last_name"]

    # Clerk JWTs often don't include email/name — fetch from Clerk Backend API
    if email.blank? && clerk_id.present? && ENV["CLERK_SECRET_KEY"].present?
      begin
        clerk_response = HTTParty.get(
          "https://api.clerk.com/v1/users/#{clerk_id}",
          headers: { "Authorization" => "Bearer #{ENV['CLERK_SECRET_KEY']}" },
          timeout: 5
        )
        if clerk_response.success?
          clerk_user = clerk_response.parsed_response
          primary_email_id = clerk_user["primary_email_address_id"]
          email_addresses = clerk_user["email_addresses"] || []
          primary_email = email_addresses.find { |e| e["id"] == primary_email_id }
          email = primary_email&.dig("email_address") || email_addresses.first&.dig("email_address")
          first_name ||= clerk_user["first_name"]
          last_name ||= clerk_user["last_name"]
        end
      rescue => e
        Rails.logger.warn("Clerk API lookup failed: #{e.message}")
      end
    end

    @current_user = find_or_create_user(
      clerk_id: clerk_id,
      email: email,
      first_name: first_name,
      last_name: last_name
    )

    unless @current_user
      if @authentication_denial_reason.present?
        render_forbidden(access_denial_message(@authentication_denial_reason), code: @authentication_denial_reason)
      else
        render_unauthorized("Unable to authenticate user")
      end
    end
  end

  def current_user
    @current_user
  end

  def require_admin!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.admin?
      render_forbidden("Admin access required")
    end
  end

  def require_staff!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.staff?
      render_forbidden("Staff access required")
    end
  end

  def find_or_create_user(clerk_id:, email:, first_name:, last_name:)
    return nil if clerk_id.blank?

    # Find by clerk_id (returning user)
    user = User.find_by(clerk_id: clerk_id)

    if user
      if user.archived?
        @authentication_denial_reason = "account_archived"
        return nil
      end

      updates = {}
      updates[:email] = email if email.present? && email != user.email
      updates[:first_name] = first_name if first_name.present?
      updates[:last_name] = last_name if last_name.present?
      updates[:role] = :admin if owner_admin_email?(email || user.email) && !user.admin?
      # Every authenticated API request counts as activity; sign-in time is
      # advanced only by sessions#create so admin reporting can distinguish them.
      updates[:last_seen_at] = Time.current
      user.update(updates) if updates.any?
      return user
    end

    # Find by email (invited user signing in for first time)
    if email.present?
      user = User.find_by("LOWER(email) = ?", email.downcase)

      if user
        if user.archived?
          @authentication_denial_reason = "account_archived"
          return nil
        end

        updates = {
          clerk_id: clerk_id,
          first_name: first_name,
          last_name: last_name,
          last_sign_in_at: Time.current,
          last_seen_at: Time.current
        }
        updates[:role] = :admin if owner_admin_email?(email)
        user.update(updates)
        return user
      end
    end

    # Auto-create first user as admin only in local/test bootstrap contexts.
    # Production should be explicitly seeded/invited, not opened by whoever
    # signs in first through Clerk.
    if User.count.zero? && allow_auth_bootstrap?
      user_email = email.presence || "#{clerk_id}@placeholder.local"
      return User.create(
        clerk_id: clerk_id,
        email: user_email,
        first_name: first_name,
        last_name: last_name,
        role: :admin,
        last_sign_in_at: Time.current,
        last_seen_at: Time.current
      )
    end

    # Local development can optionally mimic open signups. Production remains
    # invite-only: new Clerk identities must match a pending user record above.
    if email.present? && allow_open_signup?
      owner_admin = owner_admin_email?(email)
      user = User.create(
        clerk_id: clerk_id,
        email: email,
        first_name: first_name,
        last_name: last_name,
        role: owner_admin ? :admin : :student,
        last_sign_in_at: Time.current,
        last_seen_at: Time.current
      )

      # Auto-enroll in active bootcamp cohort
      if user.persisted? && !owner_admin
        active_cohort = Cohort.active.bootcamp.first
        if active_cohort
          enrollment = Enrollment.create(user: user, cohort: active_cohort)
          # Create module assignments for all curriculum modules
          if enrollment.persisted?
            active_cohort.curriculum.modules.each do |mod|
              ModuleAssignment.create(enrollment: enrollment, curriculum_module: mod)
            end
          end
        end
      end

      return user if user.persisted?
    end

    @authentication_denial_reason = "account_not_authorized"
    nil
  end

  def access_denial_message(reason)
    if reason == "account_archived"
      "This CSG account has been deactivated. Contact Code School support if you believe this is a mistake."
    else
      "This account does not have access to CSG Learning yet. Ask a Code School administrator to invite this email address."
    end
  end

  def allow_auth_bootstrap?
    return false if Rails.env.production?

    Rails.env.development? || Rails.env.test? || ActiveModel::Type::Boolean.new.cast(ENV["ALLOW_AUTH_BOOTSTRAP"])
  end

  def owner_admin_email?(email)
    normalized = email.to_s.strip.downcase
    return false if normalized.blank?

    owner_emails = ENV.fetch("OWNER_ADMIN_EMAILS", "").split(",")
    owner_emails.map { |owner_email| owner_email.to_s.strip.downcase }.include?(normalized)
  end

  def allow_open_signup?
    return false if Rails.env.production?

    Rails.env.development? || ActiveModel::Type::Boolean.new.cast(ENV["ALLOW_OPEN_SIGNUPS"])
  end

  def render_unauthorized(message = "Unauthorized")
    render json: { error: message }, status: :unauthorized
  end

  def render_forbidden(message = "Forbidden", code: nil)
    payload = { error: message }
    payload[:code] = code if code.present?
    render json: payload, status: :forbidden
  end
end

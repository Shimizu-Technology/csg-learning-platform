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
      render_unauthorized("Unable to authenticate user")
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
      updates = {}
      updates[:email] = email if email.present? && email != user.email
      updates[:first_name] = first_name if first_name.present?
      updates[:last_name] = last_name if last_name.present?
      updates[:last_sign_in_at] = Time.current
      user.update(updates) if updates.any?
      return user
    end

    # Find by email (invited user signing in for first time)
    if email.present?
      user = User.find_by("LOWER(email) = ?", email.downcase)

      if user
        user.update(clerk_id: clerk_id, first_name: first_name, last_name: last_name, last_sign_in_at: Time.current)
        return user
      end
    end

    # Auto-create first user as admin
    if User.count.zero?
      user_email = email.presence || "#{clerk_id}@placeholder.local"
      return User.create(
        clerk_id: clerk_id,
        email: user_email,
        first_name: first_name,
        last_name: last_name,
        role: :admin,
        last_sign_in_at: Time.current
      )
    end

    # Auto-create new users as students and enroll in active cohort
    if email.present?
      user = User.create(
        clerk_id: clerk_id,
        email: email,
        first_name: first_name,
        last_name: last_name,
        role: :student,
        last_sign_in_at: Time.current
      )

      # Auto-enroll in active bootcamp cohort
      if user.persisted?
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

    nil
  end

  def render_unauthorized(message = "Unauthorized")
    render json: { error: message }, status: :unauthorized
  end

  def render_forbidden(message = "Forbidden")
    render json: { error: message }, status: :forbidden
  end
end

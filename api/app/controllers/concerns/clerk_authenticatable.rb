module ClerkAuthenticatable
  extend ActiveSupport::Concern

  private

  def authenticate_user!
    header = request.headers["Authorization"]
    unless header.present?
      render_unauthorized("Missing authorization header")
      return
    end

    decoded = ClerkAuth.verify(header.split(" ").last)
    unless decoded
      render_unauthorized("Invalid or expired token")
      return
    end

    issuer = decoded["_clerk_issuer"] || decoded["iss"] || ClerkEnvironment.primary&.issuer
    issuer ||= "https://test.clerk.invalid" if Rails.env.test?
    clerk_id = decoded["sub"]
    if issuer.blank? || clerk_id.blank?
      render_unauthorized("Invalid or expired token")
      return
    end

    @current_clerk_issuer = ClerkEnvironment.normalize_issuer(issuer)
    @current_clerk_environment = decoded["_clerk_environment"]
    if Rails.env.production? && %w[development legacy].include?(@current_clerk_environment)
      Rails.logger.info("[ClerkAuth] legacy_development_session")
    end

    @current_user = resolve_known_clerk_user(issuer: @current_clerk_issuer, clerk_id: clerk_id)
    if @current_user.nil? && @authentication_denial_reason.blank?
      profile = ClerkUserProfileService.new.fetch(issuer: @current_clerk_issuer, clerk_user_id: clerk_id)
      @current_user = resolve_new_clerk_identity(
        issuer: @current_clerk_issuer,
        clerk_id: clerk_id,
        profile: profile,
        decoded: decoded
      )
    end

    if @current_user
      update_authenticated_user(@current_user, decoded)
      return
    end

    if @authentication_denial_reason.present?
      render_forbidden(access_denial_message(@authentication_denial_reason), code: @authentication_denial_reason)
    else
      render_unauthorized("Unable to authenticate user")
    end
  end

  def current_user
    @current_user
  end

  def require_admin!
    authenticate_user! unless @current_user
    return if performed?

    render_forbidden("Admin access required") unless @current_user&.admin?
  end

  def require_staff!
    authenticate_user! unless @current_user
    return if performed?

    render_forbidden("Staff access required") unless @current_user&.staff?
  end

  def resolve_known_clerk_user(issuer:, clerk_id:)
    identity = ClerkIdentity.includes(:user).find_by(issuer: issuer, clerk_user_id: clerk_id)
    if identity
      identity.touch_last_seen!
      return authorized_user(identity.user)
    end

    # Backwards-compatible lazy backfill is limited to the legacy development
    # issuer. A production subject must never match the old unscoped column.
    legacy_environment = ClerkEnvironment.all.find(&:development?) ||
      ClerkEnvironment.all.find { |environment| environment.name == "legacy" }
    return nil unless legacy_environment&.issuer == issuer

    legacy_user = User.find_by(clerk_id: clerk_id)
    return nil unless legacy_user
    return nil unless attach_clerk_identity(legacy_user, issuer: issuer, clerk_id: clerk_id)

    authorized_user(legacy_user)
  end

  def resolve_new_clerk_identity(issuer:, clerk_id:, profile:, decoded:)
    # In production, an unknown Clerk subject must be resolved through the
    # matching Clerk Backend API and have a verified primary email. Signed JWT
    # claims alone are not enough to attach a new identity to an existing user.
    if profile.nil? && Rails.env.test?
      claimed_email = decoded["email"] || decoded["primary_email_address"]
      profile = {
        email: claimed_email.to_s.strip.downcase.presence,
        email_verified: claimed_email.present?,
        first_name: decoded["first_name"],
        last_name: decoded["last_name"],
        external_id: nil
      }
    end

    unless profile&.dig(:email_verified) && profile[:email].present?
      @authentication_denial_reason = "identity_unverified"
      return nil
    end

    user = find_user_for_verified_profile(profile)
    return nil if @authentication_denial_reason.present?

    if user
      return nil unless authorized_user(user)
      return nil unless attach_clerk_identity(user, issuer: issuer, clerk_id: clerk_id)

      update_user_from_profile(user, profile)
      return user
    end

    return create_local_user(issuer: issuer, clerk_id: clerk_id, profile: profile) if allow_open_signup? || (User.count.zero? && allow_auth_bootstrap?)

    @authentication_denial_reason = "account_not_authorized"
    nil
  end

  def find_user_for_verified_profile(profile)
    external_id = profile[:external_id].to_s
    if external_id.present?
      unless external_id.match?(/\A\d+\z/)
        @authentication_denial_reason = "identity_conflict"
        return nil
      end

      external_user = User.find_by(id: external_id.to_i)
      return external_user if external_user && external_user.email.casecmp?(profile[:email])

      Rails.logger.warn("[ClerkAuth] external_id_mismatch")
      @authentication_denial_reason = "identity_conflict"
      return nil
    end

    User.find_by("LOWER(email) = ?", profile[:email].downcase)
  end

  def attach_clerk_identity(user, issuer:, clerk_id:)
    user.with_lock do
      subject_identity = ClerkIdentity.find_by(issuer: issuer, clerk_user_id: clerk_id)
      if subject_identity && subject_identity.user_id != user.id
        @authentication_denial_reason = "identity_conflict"
        Rails.logger.error("[ClerkAuth] subject_already_attached issuer=#{issuer}")
        return nil
      end

      issuer_identity = user.clerk_identities.find_by(issuer: issuer)
      if issuer_identity && issuer_identity.clerk_user_id != clerk_id
        @authentication_denial_reason = "identity_conflict"
        Rails.logger.error("[ClerkAuth] user_has_different_subject user_id=#{user.id} issuer=#{issuer}")
        return nil
      end

      identity = subject_identity || issuer_identity || user.clerk_identities.create!(
        issuer: issuer,
        clerk_user_id: clerk_id,
        last_seen_at: Time.current
      )
      identity.touch_last_seen!

      # Preserve established Clerk IDs during the transition. Pending users
      # still graduate to their first real Clerk subject as they do today.
      if user.clerk_id.blank? || user.invite_pending?
        user.update!(clerk_id: clerk_id, last_sign_in_at: Time.current)
      end

      identity
    end
  rescue ActiveRecord::RecordNotUnique
    identity = ClerkIdentity.find_by(issuer: issuer, clerk_user_id: clerk_id)
    return identity if identity&.user_id == user.id

    @authentication_denial_reason = "identity_conflict"
    nil
  end

  def authorized_user(user)
    if user.archived?
      @authentication_denial_reason = "account_archived"
      return nil
    end

    user
  end

  def update_authenticated_user(user, decoded)
    updates = {}
    updates[:first_name] = decoded["first_name"] if decoded["first_name"].present?
    updates[:last_name] = decoded["last_name"] if decoded["last_name"].present?
    updates[:role] = :admin if owner_admin_email?(user.email) && !user.admin?
    updates[:last_seen_at] = Time.current
    user.update(updates)
  end

  def update_user_from_profile(user, profile)
    updates = {
      first_name: profile[:first_name].presence || user.first_name,
      last_name: profile[:last_name].presence || user.last_name,
      last_sign_in_at: Time.current,
      last_seen_at: Time.current
    }
    updates[:role] = :admin if owner_admin_email?(profile[:email])
    user.update!(updates)
  end

  def create_local_user(issuer:, clerk_id:, profile:)
    owner_admin = owner_admin_email?(profile[:email])
    role = User.count.zero? && allow_auth_bootstrap? ? :admin : (owner_admin ? :admin : :student)
    authenticated_user = nil
    User.transaction do
      user = User.create(
        clerk_id: clerk_id,
        email: profile[:email],
        first_name: profile[:first_name],
        last_name: profile[:last_name],
        role: role,
        last_sign_in_at: Time.current,
        last_seen_at: Time.current
      )
      next unless user.persisted?
      raise ActiveRecord::Rollback unless attach_clerk_identity(user, issuer: issuer, clerk_id: clerk_id)

      enroll_local_student(user) if user.student?
      authenticated_user = user
    end
    authenticated_user
  end

  def enroll_local_student(user)
    active_cohort = Cohort.active.bootcamp.first
    return unless active_cohort

    user.with_lock do
      enrollment = Enrollment.create(user: user, cohort: active_cohort)
      next unless enrollment.persisted?

      active_cohort.curriculum.modules.each do |curriculum_module|
        ModuleAssignment.create(enrollment: enrollment, curriculum_module: curriculum_module)
      end
    end
  end

  def access_denial_message(reason)
    case reason
    when "account_archived"
      "This CSG account has been deactivated. Contact Code School support if you believe this is a mistake."
    when "identity_conflict"
      "This sign-in could not be safely matched to your CSG account. Contact Code School support."
    when "identity_unverified"
      "Your verified email could not be confirmed. Try Google sign-in or contact Code School support."
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

    ENV.fetch("OWNER_ADMIN_EMAILS", "").split(",").map { |entry| entry.to_s.strip.downcase }.include?(normalized)
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

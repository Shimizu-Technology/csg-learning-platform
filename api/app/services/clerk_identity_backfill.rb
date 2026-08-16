class ClerkIdentityBackfill
  Result = Data.define(:user_id, :email, :status, :detail)

  def initialize(environment:, apply: false)
    @environment = environment
    @apply = apply
  end

  def call
    raise ArgumentError, "Clerk environment is required" unless @environment

    eligible_users.map { |user| backfill(user) }
  end

  private

  def eligible_users
    User.where.not("clerk_id LIKE ?", "pending_%").order(:id)
  end

  def backfill(user)
    existing = user.clerk_identities.find_by(issuer: @environment.issuer)
    if existing
      status = existing.clerk_user_id == user.clerk_id ? :unchanged : :conflict
      return Result.new(user.id, user.email, status, existing.clerk_user_id)
    end

    subject_owner = ClerkIdentity.find_by(issuer: @environment.issuer, clerk_user_id: user.clerk_id)
    return Result.new(user.id, user.email, :conflict, "subject belongs to user #{subject_owner.user_id}") if subject_owner
    return Result.new(user.id, user.email, :would_create, user.clerk_id) unless @apply

    user.with_lock do
      user.clerk_identities.create!(
        issuer: @environment.issuer,
        clerk_user_id: user.clerk_id,
        last_seen_at: user.last_seen_at
      )
    end
    Result.new(user.id, user.email, :created, user.clerk_id)
  rescue ActiveRecord::RecordNotUnique
    Result.new(user.id, user.email, :conflict, "identity changed concurrently")
  end
end

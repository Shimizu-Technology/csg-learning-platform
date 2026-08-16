require "test_helper"

class ClerkIdentityTransitionTest < ActionDispatch::IntegrationTest
  setup do
    @development_issuer = "https://dev.clerk.test"
    @production_issuer = "https://prod.clerk.test"
    @user = User.create!(
      clerk_id: "dev_subject",
      email: "transition@example.com",
      first_name: "Transition",
      last_name: "Student",
      role: :student
    )
  end

  test "lazily records the existing development identity without changing the user" do
    environments = [ ClerkEnvironment.new(name: "development", issuer: @development_issuer) ]
    with_clerk_environments(environments) do
      with_auth_payload(payload(issuer: @development_issuer, subject: "dev_subject")) do
        post "/api/v1/sessions", headers: auth_headers
      end
    end

    assert_response :success
    assert_equal "dev_subject", @user.reload.clerk_id
    assert_equal "dev_subject", @user.clerk_identities.find_by!(issuer: @development_issuer).clerk_user_id
  end

  test "adds a production identity while preserving the legacy subject and push registrations" do
    @user.clerk_identities.create!(issuer: @development_issuer, clerk_user_id: "dev_subject")
    @user.push_subscriptions.create!(
      endpoint: "https://push.example.com/transition",
      p256dh: "p256dh",
      auth: "auth",
      last_seen_at: Time.current
    )
    @user.mobile_push_tokens.create!(token: "ExpoPushToken[transition]", platform: "ios", last_seen_at: Time.current)
    profile = verified_profile(@user)

    with_profile(profile) do
      with_auth_payload(payload(issuer: @production_issuer, subject: "prod_subject")) do
        post "/api/v1/sessions", headers: auth_headers
      end
    end

    assert_response :success
    assert_equal "dev_subject", @user.reload.clerk_id
    assert_equal "prod_subject", @user.clerk_identities.find_by!(issuer: @production_issuer).clerk_user_id
    assert_equal 1, @user.push_subscriptions.count
    assert_equal 1, @user.mobile_push_tokens.count
  end

  test "rejects a second subject for the same user and issuer" do
    @user.clerk_identities.create!(issuer: @production_issuer, clerk_user_id: "prod_subject_one")

    with_profile(verified_profile(@user)) do
      with_auth_payload(payload(issuer: @production_issuer, subject: "prod_subject_two")) do
        post "/api/v1/sessions", headers: auth_headers
      end
    end

    assert_response :forbidden
    assert_equal "identity_conflict", JSON.parse(response.body).fetch("code")
    assert_equal [ "prod_subject_one" ], @user.clerk_identities.where(issuer: @production_issuer).pluck(:clerk_user_id)
  end

  test "an archived user remains blocked through an identity alias" do
    @user.update!(archived_at: Time.current)
    @user.clerk_identities.create!(issuer: @production_issuer, clerk_user_id: "prod_archived")

    with_auth_payload(payload(issuer: @production_issuer, subject: "prod_archived")) do
      post "/api/v1/sessions", headers: auth_headers
    end

    assert_response :forbidden
    assert_equal "account_archived", JSON.parse(response.body).fetch("code")
  end

  test "a production subject cannot match the unscoped legacy Clerk ID" do
    environments = [
      ClerkEnvironment.new(name: "development", issuer: @development_issuer),
      ClerkEnvironment.new(name: "production", issuer: @production_issuer, secret_key: "sk_live_test")
    ]

    with_clerk_environments(environments) do
      with_profile(nil) do
        with_auth_payload(payload(issuer: @production_issuer, subject: "dev_subject")) do
          post "/api/v1/sessions", headers: auth_headers
        end
      end
    end

    assert_response :forbidden
    assert_equal "identity_unverified", JSON.parse(response.body).fetch("code")
    assert_empty @user.clerk_identities
  end

  test "an external ID conflict cannot fall through to open signup" do
    original_open_signups = ENV["ALLOW_OPEN_SIGNUPS"]
    ENV["ALLOW_OPEN_SIGNUPS"] = "true"
    profile = verified_profile(@user).merge(email: "different@example.com")

    with_profile(profile) do
      with_auth_payload(payload(issuer: @production_issuer, subject: "prod_conflict")) do
        post "/api/v1/sessions", headers: auth_headers
      end
    end

    assert_response :forbidden
    assert_equal "identity_conflict", JSON.parse(response.body).fetch("code")
    assert_not User.exists?(email: "different@example.com")
  ensure
    original_open_signups.nil? ? ENV.delete("ALLOW_OPEN_SIGNUPS") : ENV["ALLOW_OPEN_SIGNUPS"] = original_open_signups
  end

  test "a stale production external ID cannot fall back to an email match" do
    profile = verified_profile(@user).merge(external_id: "999999999")

    with_profile(profile) do
      with_auth_payload(payload(issuer: @production_issuer, subject: "prod_stale_external")) do
        post "/api/v1/sessions", headers: auth_headers
      end
    end

    assert_response :forbidden
    assert_equal "identity_conflict", JSON.parse(response.body).fetch("code")
    assert_empty @user.clerk_identities
  end

  test "a concurrent local signup recovers the winning user and identity" do
    winner = User.create!(
      clerk_id: "local_race_subject",
      email: "local-race@example.com",
      first_name: "Local",
      role: :student
    )
    profile = verified_profile(winner).merge(external_id: nil)
    controller = Api::V1::SessionsController.new
    original_create = User.method(:create)
    User.define_singleton_method(:create) { |**_attributes| raise ActiveRecord::RecordNotUnique }

    resolved = controller.send(
      :create_local_user,
      issuer: @development_issuer,
      clerk_id: winner.clerk_id,
      profile: profile
    )

    assert_equal winner, resolved
    assert_equal winner.clerk_id,
      winner.clerk_identities.find_by!(issuer: @development_issuer).clerk_user_id
  ensure
    User.define_singleton_method(:create, original_create) if defined?(original_create) && original_create
  end

  private

  def payload(issuer:, subject:)
    {
      "sub" => subject,
      "iss" => issuer,
      "_clerk_issuer" => issuer,
      "_clerk_environment" => issuer == @production_issuer ? "production" : "development"
    }
  end

  def verified_profile(user)
    {
      email: user.email,
      email_verified: true,
      first_name: user.first_name,
      last_name: user.last_name,
      external_id: user.id.to_s
    }
  end

  def auth_headers
    { "Authorization" => "Bearer transition_token" }
  end

  def with_auth_payload(value)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| value }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def with_profile(value)
    service = Object.new
    service.define_singleton_method(:fetch) { |**_arguments| value }
    original = ClerkUserProfileService.method(:new)
    ClerkUserProfileService.define_singleton_method(:new) { service }
    yield
  ensure
    ClerkUserProfileService.define_singleton_method(:new, original)
  end

  def with_clerk_environments(environments)
    original = ClerkEnvironment.method(:all)
    ClerkEnvironment.define_singleton_method(:all) { environments }
    yield
  ensure
    ClerkEnvironment.define_singleton_method(:all, original)
  end
end

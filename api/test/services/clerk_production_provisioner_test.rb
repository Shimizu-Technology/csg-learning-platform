require "test_helper"

class ClerkProductionProvisionerTest < ActiveSupport::TestCase
  setup do
    @environment = ClerkEnvironment.new(
      name: "production",
      issuer: "https://prod.clerk.test",
      secret_key: "sk_live_test"
    )
    @active = User.create!(clerk_id: "dev_active", email: "provision-active@example.com", first_name: "Active", role: :student)
    User.create!(clerk_id: "dev_archived", email: "provision-archived@example.com", role: :student, archived_at: Time.current)
    User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "provision-pending@example.com", role: :student)
  end

  test "dry run includes only active established users and does not create anything" do
    calls = []
    with_http(
      get: ->(*_arguments) { successful_response([]) },
      post: ->(*arguments) { calls << arguments; raise "unexpected POST" }
    ) do
      results = ClerkProductionProvisioner.new(environment: @environment).call
      assert_equal [ @active.id ], results.map(&:user_id)
      assert_equal [ :would_create ], results.map(&:status)
      assert_empty calls
      assert_empty @active.clerk_identities
    end
  end

  test "apply creates a verified email-only production shell and attaches its identity" do
    posted_body = nil
    clerk_user = clerk_payload(id: "prod_subject", user: @active)
    with_http(
      get: ->(*_arguments) { successful_response([]) },
      post: ->(_url, options) { posted_body = JSON.parse(options.fetch(:body)); successful_response(clerk_user) }
    ) do
      results = ClerkProductionProvisioner.new(environment: @environment, apply: true).call
      assert_equal [ :created ], results.map(&:status)
    end

    assert_equal [ @active.email ], posted_body.fetch("email_address")
    assert_equal @active.id.to_s, posted_body.fetch("external_id")
    assert_equal true, posted_body.fetch("skip_password_requirement")
    assert_equal "prod_subject", @active.clerk_identities.find_by!(issuer: @environment.issuer).clerk_user_id
    assert_equal "dev_active", @active.reload.clerk_id
  end

  test "apply finds an existing production user and is idempotent" do
    clerk_user = clerk_payload(id: "prod_existing", user: @active)
    with_http(
      get: ->(*_arguments) { successful_response([ clerk_user ]) },
      post: ->(*_arguments) { raise "unexpected POST" }
    ) do
      first = ClerkProductionProvisioner.new(environment: @environment, apply: true).call
      second = ClerkProductionProvisioner.new(environment: @environment, apply: true).call
      assert_equal [ :attached ], first.map(&:status)
      assert_equal [ :unchanged ], second.map(&:status)
    end

    assert_equal 1, @active.clerk_identities.where(issuer: @environment.issuer).count
  end

  test "does not attach an email match carrying another Rails external ID" do
    clerk_user = clerk_payload(id: "prod_conflict", user: @active).merge("external_id" => "999999")
    with_http(
      get: ->(*_arguments) { successful_response([ clerk_user ]) },
      post: ->(*_arguments) { raise "unexpected POST" }
    ) do
      result = ClerkProductionProvisioner.new(environment: @environment, apply: true).call.sole
      assert_equal :conflict, result.status
      assert_match(/external ID/, result.detail)
    end

    assert_empty @active.clerk_identities
  end

  test "fails safely when Clerk creates a user without returning an ID" do
    with_http(
      get: ->(*_arguments) { successful_response([]) },
      post: ->(*_arguments) { successful_response({}) }
    ) do
      result = ClerkProductionProvisioner.new(environment: @environment, apply: true).call.sole
      assert_equal :failed, result.status
      assert_match(/did not include a user ID/, result.detail)
    end

    assert_empty @active.clerk_identities
  end

  test "does not attach an existing production user with an unverified primary email" do
    clerk_user = clerk_payload(id: "prod_unverified", user: @active)
    clerk_user["email_addresses"].first["verification"] = { "status" => "unverified" }
    with_http(
      get: ->(*_arguments) { successful_response([ clerk_user ]) },
      post: ->(*_arguments) { raise "unexpected POST" }
    ) do
      result = ClerkProductionProvisioner.new(environment: @environment, apply: true).call.sole
      assert_equal :conflict, result.status
      assert_match(/not verified/, result.detail)
    end

    assert_empty @active.clerk_identities
  end

  test "reports multiple matching production users instead of choosing one" do
    by_external_id = clerk_payload(id: "prod_external", user: @active)
    by_email = clerk_payload(id: "prod_email", user: @active).merge("external_id" => nil)
    with_http(
      get: ->(*_arguments) { successful_response([ by_external_id, by_email ]) },
      post: ->(*_arguments) { raise "unexpected POST" }
    ) do
      result = ClerkProductionProvisioner.new(environment: @environment, apply: true).call.sole
      assert_equal :conflict, result.status
      assert_match(/multiple production users/, result.detail)
    end

    assert_empty @active.clerk_identities
  end

  private

  def clerk_payload(id:, user:)
    {
      "id" => id,
      "external_id" => user.id.to_s,
      "primary_email_address_id" => "email_#{id}",
      "email_addresses" => [
        {
          "id" => "email_#{id}",
          "email_address" => user.email,
          "verification" => { "status" => "verified" }
        }
      ]
    }
  end

  def successful_response(payload)
    Struct.new(:parsed_response) { def success? = true }.new(payload)
  end

  def with_http(get:, post:)
    original_get = HTTParty.method(:get)
    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:get) { |*arguments, **options| get.call(*arguments, options) }
    HTTParty.define_singleton_method(:post) { |*arguments, **options| post.call(*arguments, options) }
    yield
  ensure
    HTTParty.define_singleton_method(:get, original_get)
    HTTParty.define_singleton_method(:post, original_post)
  end
end
